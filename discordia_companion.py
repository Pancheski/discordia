#!/usr/bin/env python3
"""
Discordia Host — Agente de Controle Virtual Xbox 360 (System Tray / Background)
===============================================================================

Roda silenciosamente em segundo plano na bandeja do Windows (System Tray),
escutando em `ws://127.0.0.1:8765` e emulando até 4 controles Xbox 360 virtuais
via ViGEmBus (`vgamepad`) para o recurso Remote Play / Jogar Junto do Discordia.

Inclui lazy-loading do driver ViGEmBus e auto-instalação de 1 clique sem crashes
caso o driver ainda não esteja presente no Windows.
"""

import asyncio
import ctypes
import json
import logging
import os
import subprocess
import sys
import threading
import time
from typing import Any, Dict, List, Optional

import websockets

# Suporte opcional para ícone na Bandeja do Sistema (System Tray)
try:
    import pystray
    from PIL import Image, ImageDraw

    HAS_TRAY = True
except ImportError:
    HAS_TRAY = False

HOST = "127.0.0.1"
PORT = 8765
SINGLE_INSTANCE_MUTEX = "Global\\DiscordiaHostCompanionMutex_v1"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [DiscordiaHost] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("discordia_host")


def silent_exception_hook(exc_type, exc_value, exc_traceback):
    """Garante que exceções não tratadas nunca abram pop-ups de erro no Windows."""
    if issubclass(exc_type, KeyboardInterrupt):
        sys.__excepthook__(exc_type, exc_value, exc_traceback)
        return
    logger.error("Exceção não tratada capturada (silenciosa):", exc_info=(exc_type, exc_value, exc_traceback))


sys.excepthook = silent_exception_hook

# Mapeamento do índice padrão W3C Standard Gamepad -> Constantes XInput / vgamepad.XUSB_BUTTON
XINPUT_BUTTON_MAP = {
    0: 0x1000,  # XUSB_GAMEPAD_A
    1: 0x2000,  # XUSB_GAMEPAD_B
    2: 0x4000,  # XUSB_GAMEPAD_X
    3: 0x8000,  # XUSB_GAMEPAD_Y
    4: 0x0100,  # XUSB_GAMEPAD_LEFT_SHOULDER
    5: 0x0200,  # XUSB_GAMEPAD_RIGHT_SHOULDER
    # 6 = LT (gatilho analógico esquerdo)
    # 7 = RT (gatilho analógico direito)
    8: 0x0020,  # XUSB_GAMEPAD_BACK
    9: 0x0010,  # XUSB_GAMEPAD_START
    10: 0x0040, # XUSB_GAMEPAD_LEFT_THUMB
    11: 0x0080, # XUSB_GAMEPAD_RIGHT_THUMB
    12: 0x0001, # XUSB_GAMEPAD_DPAD_UP
    13: 0x0002, # XUSB_GAMEPAD_DPAD_DOWN
    14: 0x0004, # XUSB_GAMEPAD_DPAD_LEFT
    15: 0x0008, # XUSB_GAMEPAD_DPAD_RIGHT
    16: 0x0400, # XUSB_GAMEPAD_GUIDE
}


def clamp(val: float, low: float, high: float) -> float:
    return max(low, min(high, val))


def hide_console_window_if_needed() -> None:
    """Garante que nenhuma janela preta de terminal fique aberta no Windows."""
    if os.name != "nt":
        return
    if "--console" in sys.argv:
        return
    try:
        hwnd = ctypes.windll.kernel32.GetConsoleWindow()
        if hwnd:
            ctypes.windll.user32.ShowWindow(hwnd, 0)  # SW_HIDE = 0
    except Exception:
        pass


def ensure_single_instance() -> Optional[int]:
    """Evita múltiplas instâncias concorrentes do DiscordiaHost.exe na porta 8765."""
    if os.name != "nt":
        return None
    try:
        kernel32 = ctypes.windll.kernel32
        mutex = kernel32.CreateMutexW(None, False, SINGLE_INSTANCE_MUTEX)
        last_error = kernel32.GetLastError()
        if last_error == 183:  # ERROR_ALREADY_EXISTS
            sys.exit(0)
        return mutex
    except Exception:
        return None


# ─── Lazy Loading do ViGEmBus e Auto-Instalação ──────────────────────────────

_vg_module: Any = None
_driver_ready: bool = False


def find_vigem_msi() -> Optional[str]:
    """Localiza o instalador ViGEmBusSetup_x64.msi embutido ou nos diretórios da aplicação."""
    search_dirs: List[str] = []

    if getattr(sys, "frozen", False):
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            search_dirs.append(meipass)
            search_dirs.append(os.path.join(meipass, "vgamepad"))
        exe_dir = os.path.dirname(sys.executable)
        search_dirs.append(exe_dir)
        search_dirs.append(os.path.join(exe_dir, "resources"))
        search_dirs.append(os.path.join(exe_dir, "vgamepad"))

    script_dir = os.path.dirname(os.path.abspath(__file__))
    search_dirs.append(script_dir)
    search_dirs.append(os.path.join(script_dir, "vgamepad"))

    for base_dir in search_dirs:
        if not os.path.exists(base_dir):
            continue
        candidates = [
            os.path.join(base_dir, "vgamepad", "win", "vigem", "install", "x64", "ViGEmBusSetup_x64.msi"),
            os.path.join(base_dir, "win", "vigem", "install", "x64", "ViGEmBusSetup_x64.msi"),
            os.path.join(base_dir, "vigem", "install", "x64", "ViGEmBusSetup_x64.msi"),
            os.path.join(base_dir, "ViGEmBusSetup_x64.msi"),
        ]
        for c in candidates:
            if os.path.isfile(c):
                logger.info("ViGEmBusSetup_x64.msi localizado em: %s", c)
                return os.path.abspath(c)

        for root, _dirs, files in os.walk(base_dir):
            for file in files:
                if file.lower() == "vigembussetup_x64.msi":
                    found = os.path.abspath(os.path.join(root, file))
                    logger.info("ViGEmBusSetup_x64.msi localizado via busca em: %s", found)
                    return found

    return None


def get_vgamepad():
    """Tenta importar vgamepad de forma lazy e segura sem quebrar o servidor WebSocket."""
    global _vg_module, _driver_ready
    if _vg_module is not None:
        return _vg_module
    try:
        import vgamepad as vg
        _vg_module = vg
        _driver_ready = True
        logger.info("Driver ViGEmBus e módulo vgamepad carregados com sucesso!")
        return _vg_module
    except Exception as e:
        logger.warning("ViGEmBus não detectado ou indisponível: %s", e)
        _vg_module = None
        _driver_ready = False
        return None


def is_driver_ready() -> bool:
    """Retorna True se o driver ViGEmBus estiver pronto e funcional no sistema."""
    global _driver_ready
    if _driver_ready and _vg_module is not None:
        return True
    mod = get_vgamepad()
    return mod is not None


def install_vigem_driver() -> bool:
    """Dispara a instalação silenciosa/passiva e com elevação (UAC) do driver ViGEmBus."""
    global _vg_module, _driver_ready
    msi_path = find_vigem_msi()
    if not msi_path:
        logger.error("ViGEmBusSetup_x64.msi não foi encontrado no bundle.")
        return False

    logger.info("Executando instalação com UAC do ViGEmBus: %s", msi_path)
    try:
        cmd = f'Start-Process msiexec.exe -ArgumentList \'/i "{msi_path}" /passive /norestart\' -Verb RunAs -Wait'
        res = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", cmd],
            capture_output=True,
            timeout=180,
        )
        logger.info("Processo msiexec finalizado via PowerShell com código: %s", res.returncode)
    except Exception as e:
        logger.warning("Falha ao aguardar via PowerShell, tentando ShellExecuteW: %s", e)
        try:
            ctypes.windll.shell32.ShellExecuteW(None, "runas", "msiexec.exe", f'/i "{msi_path}" /passive /norestart', None, 1)
            time.sleep(6)
        except Exception as e2:
            logger.error("Erro ao invocar ShellExecuteW: %s", e2)
            return False

    time.sleep(3)

    # Limpa cache do módulo se o import falhou antes
    for mod_name in list(sys.modules.keys()):
        if "vgamepad" in mod_name:
            del sys.modules[mod_name]
    _vg_module = None
    _driver_ready = False

    return is_driver_ready()


def ensure_vigem_driver(auto_install: bool = False) -> bool:
    """Garante que o driver esteja pronto, efetuando auto-instalação opcional."""
    if is_driver_ready():
        return True
    if auto_install:
        return install_vigem_driver()
    return False


# ─── Emulação de Controles Xbox 360 Virtuais ────────────────────────────────

class Xbox360Emulator:
    def __init__(self, slot: int = 1) -> None:
        self.slot = slot
        self.gamepad = None
        self._init_gamepad()

    def _init_gamepad(self) -> bool:
        if self.gamepad is not None:
            return True
        vg = get_vgamepad()
        if not vg:
            return False
        try:
            logger.info("Inicializando controle virtual Xbox 360 (Slot %d) via ViGEmBus...", self.slot)
            self.gamepad = vg.VX360Gamepad()
            self.reset()
            logger.info("Controle Xbox 360 Virtual pronto no Windows (Slot %d)!", self.slot)
            return True
        except Exception as e:
            logger.error("Falha ao inicializar VX360Gamepad no Slot %d: %s", self.slot, e)
            self.gamepad = None
            return False

    def reset(self) -> None:
        """Solta todos os botões, gatilhos e analógicos imediatamente."""
        if self.gamepad:
            try:
                self.gamepad.reset()
                self.gamepad.update()
            except Exception:
                pass

    def apply_state(self, payload: Dict[str, Any]) -> None:
        if not self.gamepad:
            if not self._init_gamepad():
                return

        buttons: List[float] = payload.get("buttons") or []
        axes: List[float] = payload.get("axes") or [0.0, 0.0, 0.0, 0.0]
        triggers: List[float] = payload.get("triggers") or []

        try:
            # 1) Atualiza botões digitais XInput
            for idx, xusb_btn in XINPUT_BUTTON_MAP.items():
                pressed = idx < len(buttons) and float(buttons[idx]) > 0.5
                if pressed:
                    self.gamepad.press_button(button=xusb_btn)
                else:
                    self.gamepad.release_button(button=xusb_btn)

            # 2) Atualiza gatilhos analógicos (LT = índice 6, RT = índice 7)
            lt_val = float(triggers[0]) if len(triggers) >= 1 else (float(buttons[6]) if len(buttons) > 6 else 0.0)
            rt_val = float(triggers[1]) if len(triggers) >= 2 else (float(buttons[7]) if len(buttons) > 7 else 0.0)
            lt_clamped = clamp(lt_val, 0.0, 1.0)
            rt_clamped = clamp(rt_val, 0.0, 1.0)

            if hasattr(self.gamepad, "left_trigger_float"):
                self.gamepad.left_trigger_float(value_float=lt_clamped)
                self.gamepad.right_trigger_float(value_float=rt_clamped)
            else:
                self.gamepad.left_trigger(value=int(round(lt_clamped * 255)))
                self.gamepad.right_trigger(value=int(round(rt_clamped * 255)))

            # 3) Atualiza analógicos (No navegador, Y negativo é para cima; no XInput, Y positivo é para cima)
            lx = clamp(float(axes[0]) if len(axes) > 0 else 0.0, -1.0, 1.0)
            ly = clamp(-float(axes[1]) if len(axes) > 1 else 0.0, -1.0, 1.0)
            rx = clamp(float(axes[2]) if len(axes) > 2 else 0.0, -1.0, 1.0)
            ry = clamp(-float(axes[3]) if len(axes) > 3 else 0.0, -1.0, 1.0)

            self.gamepad.left_joystick_float(x_value_float=lx, y_value_float=ly)
            self.gamepad.right_joystick_float(x_value_float=rx, y_value_float=ry)

            # 4) Envia pacote de estado para o driver ViGEmBus
            self.gamepad.update()
        except Exception as e:
            logger.error("Erro ao aplicar estado no gamepad do Slot %d: %s", self.slot, e)


class MultiGamepadManager:
    """Gerencia até 4 controles virtuais simultâneos de Xbox 360 (Slots 1 a 4)."""

    def __init__(self) -> None:
        self.controllers: Dict[int, Xbox360Emulator] = {}

    def get_or_create(self, slot: int = 1) -> Optional[Xbox360Emulator]:
        if slot < 1 or slot > 4:
            slot = 1
        if slot not in self.controllers:
            try:
                self.controllers[slot] = Xbox360Emulator(slot=slot)
            except Exception as e:
                logger.error("Falha ao instanciar controle virtual no Slot %d: %s", slot, e)
                return None
        ctrl = self.controllers.get(slot)
        if ctrl and ctrl.gamepad is None:
            ctrl._init_gamepad()
        return ctrl

    def disconnect(self, slot: int) -> None:
        ctrl = self.controllers.pop(slot, None)
        if ctrl:
            try:
                logger.info("Desconectando controle virtual do Slot %d...", slot)
                ctrl.reset()
            except Exception as e:
                logger.error("Erro ao desconectar controle do Slot %d: %s", slot, e)

    def reset_slot(self, slot: int) -> None:
        ctrl = self.controllers.get(slot)
        if ctrl:
            ctrl.reset()

    def reset_all(self) -> None:
        for ctrl in self.controllers.values():
            try:
                ctrl.reset()
            except Exception:
                pass

    def apply_state(self, payload: Dict[str, Any]) -> None:
        raw_slot = payload.get("slot") or payload.get("player") or 1
        try:
            slot = int(raw_slot)
        except (TypeError, ValueError):
            slot = 1
        ctrl = self.get_or_create(slot)
        if ctrl:
            ctrl.apply_state(payload)


def create_tray_icon_image() -> "Image.Image":
    """Desenha um ícone estilizado de gamepad roxo/verde para a bandeja do Windows."""
    size = 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    # Fundo circular estilo Discordia (#5865F2)
    draw.ellipse((4, 4, 60, 60), fill=(88, 101, 242, 255), outline=(35, 165, 90, 255), width=4)
    # Corpo do controle branco
    draw.rounded_rectangle((14, 22, 50, 44), radius=8, fill=(255, 255, 255, 255))
    # D-Pad esquerdo
    draw.rectangle((20, 29, 28, 33), fill=(88, 101, 242, 255))
    draw.rectangle((22, 27, 26, 35), fill=(88, 101, 242, 255))
    # Botões A/B verdes/vermelhos à direita
    draw.ellipse((36, 31, 41, 36), fill=(35, 165, 90, 255))
    draw.ellipse((42, 27, 47, 32), fill=(218, 55, 60, 255))
    return img


class CompanionServer:
    def __init__(self) -> None:
        self.manager = MultiGamepadManager()
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.stop_event: Optional[asyncio.Event] = None
        self.tray_icon: Any = None

    async def handle_client(self, websocket: Any) -> None:
        peer = getattr(websocket, "remote_address", ("127.0.0.1", 0))
        logger.info("Discordia conectado (%s).", peer)

        # Envia status do driver para o cliente Web/Desktop imediatamente na conexão
        try:
            await websocket.send(
                json.dumps({
                    "type": "companion:status",
                    "driverReady": is_driver_ready(),
                })
            )
        except Exception:
            pass

        try:
            async for raw_message in websocket:
                try:
                    data = json.loads(raw_message)
                except json.JSONDecodeError:
                    continue

                msg_type = data.get("type")
                if msg_type == "gamepad:state":
                    self.manager.apply_state(data)
                elif msg_type == "gamepad:connect":
                    slot = int(data.get("slot") or 1)
                    self.manager.get_or_create(slot)
                elif msg_type == "gamepad:disconnect":
                    slot = int(data.get("slot") or 1)
                    self.manager.disconnect(slot)
                elif msg_type == "gamepad:release":
                    slot = data.get("slot")
                    if slot is not None:
                        try:
                            self.manager.reset_slot(int(slot))
                        except (TypeError, ValueError):
                            self.manager.reset_all()
                    else:
                        self.manager.reset_all()
                elif msg_type == "driver:install":
                    logger.info("Solicitação de instalação do driver ViGEmBus recebida via WebSocket.")
                    success = install_vigem_driver()
                    await websocket.send(
                        json.dumps({
                            "type": "companion:status",
                            "driverReady": success,
                            "installed": True,
                        })
                    )
                elif msg_type == "gamepad:ping":
                    await websocket.send(
                        json.dumps({
                            "type": "gamepad:pong",
                            "status": "ready",
                            "driverReady": is_driver_ready(),
                        })
                    )
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            self.manager.reset_all()
            logger.info("Conexão encerrada (%s). Controles virtuais resetados.", peer)

    async def run_async_server(self) -> None:
        self.loop = asyncio.get_running_loop()
        self.stop_event = asyncio.Event()
        logger.info("Status do driver ViGEmBus na inicialização: %s", "Pronto" if is_driver_ready() else "Não instalado (aguardando instalação)")
        async with websockets.serve(
            self.handle_client,
            HOST,
            PORT,
            max_size=65536,
            ping_interval=15,
            ping_timeout=15,
        ):
            logger.info("Servidor WebSocket ativo em ws://%s:%d (suporte a até 4 controles)", HOST, PORT)
            await self.stop_event.wait()
        self.manager.reset_all()

    def request_stop(self) -> None:
        self.manager.reset_all()
        if self.loop and self.stop_event:
            self.loop.call_soon_threadsafe(self.stop_event.set)
        if self.tray_icon:
            try:
                self.tray_icon.stop()
            except Exception:
                pass

    def run(self) -> None:
        if not HAS_TRAY:
            asyncio.run(self.run_async_server())
            return

        # Inicia o servidor WebSocket em uma thread daemon e mantém o System Tray na thread principal
        server_thread = threading.Thread(
            target=lambda: asyncio.run(self.run_async_server()),
            daemon=True,
        )
        server_thread.start()

        menu = pystray.Menu(
            pystray.MenuItem("🟢 Discordia Host (Até 4 Controles)", lambda: None, enabled=False),
            pystray.MenuItem(
                "Resetar Todos os Controles Virtuais",
                lambda _icon, _item: self.manager.reset_all(),
            ),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem(
                "Encerrar Discordia Host",
                lambda _icon, _item: self.request_stop(),
            ),
        )
        self.tray_icon = pystray.Icon(
            "DiscordiaHost",
            create_tray_icon_image(),
            "Discordia Host — Remote Play 4P (127.0.0.1:8765)",
            menu,
        )
        self.tray_icon.run()


if __name__ == "__main__":
    _mutex = ensure_single_instance()
    hide_console_window_if_needed()
    try:
        server = CompanionServer()
        server.run()
    except KeyboardInterrupt:
        pass
    except Exception as e:
        logger.error("Erro fatal no DiscordiaHost (ignorado para evitar pop-up): %s", e, exc_info=True)
        sys.exit(0)
