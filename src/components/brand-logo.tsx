import type { ImgHTMLAttributes } from 'react'

type BrandLogoProps = ImgHTMLAttributes<HTMLImageElement> & {
  title?: string
}

export function BrandLogo({ className = '', title = 'Goal Mate', alt, ...props }: BrandLogoProps) {
  return (
    <img
      src="/brand-logo-gm.png"
      alt={alt || title}
      className={`goal-logo select-none object-cover ${className}`}
      draggable={false}
      {...props}
    />
  )
}
