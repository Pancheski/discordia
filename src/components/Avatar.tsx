import { colorFromString, initials } from '../lib/utils'

interface AvatarProps {
  name: string
  size?: number
  speaking?: boolean
  className?: string
}

export function Avatar({ name, size = 40, speaking = false, className = '' }: AvatarProps) {
  return (
    <div
      className={`relative flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white transition-shadow duration-150 ${
        speaking ? 'speaking-ring' : ''
      } ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(11, size * 0.36),
        background: `linear-gradient(135deg, ${colorFromString(name)}, ${colorFromString(name + '!')})`,
      }}
      aria-hidden="true"
    >
      {initials(name)}
    </div>
  )
}
