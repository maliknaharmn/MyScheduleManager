import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

const buttonVariants = cva('button', {
  variants: {
    variant: {
      primary: 'button-primary',
      outline: 'button-outline',
      ghost: 'button-ghost',
    },
  },
  defaultVariants: { variant: 'primary' },
})

export function Button({
  className,
  variant,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button type={type} className={cn(buttonVariants({ variant }), className)} {...props} />
}
