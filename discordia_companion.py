#!/usr/bin/env python3
"""
Discordia Host — Agente de Controle Virtual Xbox 360 (System Tray / Background)
===============================================================================

Roda silenciosamente em segundo plano na bandeja do Windows (System Tray),
escutando em `ws://127.0.0.1:8765` e emulando um controle Xbox 360 virtual via
ViGEmBus (`vgamepad`) para o recurso Remote Play / Jogar Junto do Discordia.

Para gerar o executável único `DiscordiaHost.exe` (sem janela de terminal):
  Execute `build_companion.bat` (1 clique no Windows).
"""

import asyncio
import ctypes
import json
import logging
import os
import sys
import threading
from typing import Any, Dict, List, Optional

import websockets
import vgamepad as vg

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

# Mapeamento do índice padrão W3C Standard Gamepad -> Botões XInput (vgamepad.XUSB_BUTTON)
XINPUT_BUTTON_MAP = {
    0: vg.XUSB_BUTTON.XUSB_GAMEPAD_A,
    1: vg.XUSB_BUTTON.XUSB_GAMEPAD_B,
    2: vg.XUSB_BUTTON.XUSB_GAMEPAD_X,
    3: vg.XUSB_BUTTON.XUSB_GAMEPAD_Y,
    4: vg.XUSB_BUTTON.XUSB_GAMEPAD_LEFT_SHOULDER,
    5: vg.XUSB_BUTTON.XUSB_GAMEPAD_RIGHT_SHOULDER,
    # 6 = LT (gatilho analógico esquerdo)
    # 7 = RT (gatilho analógico direito)
    8: vg.XUSB_BUTTON.XUSB_GAMEPAD_BACK,
    9: vg.XUSB_BUTTON.XUSB_GAMEPAD_START,
    10: vg.XUSB_BUTTON.XUSB_GAMEPAD_LEFT_THUMB,
    11: vg.XUSB_BUTTON.XUSB_GAMEPAD_RIGHT_THUMB,
    12: vg.XUSB_BUTTON.XUSB_GAMEPAD_DPAD_UP,
    13: vg.XUSB_BUTTON.XUSB_GAMEPAD_DPAD_DOWN,
    14: vg.XUSB_BUTTON.XUSB_GAMEPAD_DPAD_LEFT,
    15: vg.XUSB_BUTTON.XUSB_GAMEPAD_DPAD_RIGHT,
    16: vg.XUSB_BUTTON.XUSB_GAMEPAD_GUIDE,
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


class Xbox360Emulator:
    def __init__(self) -> None:
        logger.info("Inicializando controle virtual Xbox 360 via ViGEmBus...")
        self.gamepad = vg.VX360Gamepad()
        self.reset()
        logger.info("Controle Xbox 360 Virtual pronto no Windows!")

    def reset(self) -> None:
        """Solta todos os botões, gatilhos e analógicos imediatamente."""
        self.gamepad.reset()
        self.gamepad.update()

    def apply_state(self, payload: Dict[str, Any]) -> None:
        buttons: List[float] = payload.get("buttons") or []
        axes: List[float] = payload.get("axes") or [0.0, 0.0, 0.0, 0.0]
        triggers: List[float] = payload.get("triggers") or []

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
        self.emulator = Xbox360Emulator()
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.stop_event: Optional[asyncio.Event] = None
        self.tray_icon: Any = None

    async def handle_client(self, websocket: Any) -> None:
        peer = getattr(websocket, "remote_address", ("127.0.0.1", 0))
        logger.info("Discordia Web conectado (%s).", peer)
        try:
            async for raw_message in websocket:
                try:
                    data = json.loads(raw_message)
                except json.JSONDecodeError:
                    continue

                msg_type = data.get("type")
                if msg_type == "gamepad:state":
                    self.emulator.apply_state(data)
                elif msg_type == "gamepad:release":
                    self.emulator.reset()
                elif msg_type == "gamepad:ping":
                    await websocket.send(json.dumps({"type": "gamepad:pong", "status": "ready"}))
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            self.emulator.reset()
            logger.info("Conexão encerrada (%s). Controle virtual resetado.", peer)

    async def run_async_server(self) -> None:
        self.loop = asyncio.get_running_loop()
        self.stop_event = asyncio.Event()
        async with websockets.serve(
            self.handle_client,
            HOST,
            PORT,
            max_size=65536,
            ping_interval=15,
            ping_timeout=15,
        ):
            logger.info("Servidor WebSocket ativo em ws://%s:%d", HOST, PORT)
            await self.stop_event.wait()
        self.emulator.reset()

    def request_stop(self) -> None:
        self.emulator.reset()
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
            pystray.MenuItem("🟢 Discordia Host (Pronto para jogar)", lambda: None, enabled=False),
            pystray.MenuItem(
                "Resetar Controle Virtual",
                lambda _icon, _item: self.emulator.reset(),
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
            "Discordia Host — Remote Play Ativo (127.0.0.1:8765)",
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
