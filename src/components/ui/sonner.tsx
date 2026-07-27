import { Toaster as Sonner, toast } from "sonner"

function Toaster({ ...props }: React.ComponentProps<typeof Sonner>) {
  return (
    <Sonner
      className="toaster group"
      style={
        {
          "--normal-bg": "hsl(var(--popover))",
          "--normal-text": "hsl(var(--popover-foreground))",
          "--normal-border": "hsl(var(--border))",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster, toast }
