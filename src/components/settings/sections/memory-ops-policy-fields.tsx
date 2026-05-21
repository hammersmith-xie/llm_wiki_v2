import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max?: number
  step: number
  onChange: (value: string) => void
}) {
  return (
    <Label className="flex min-w-0 flex-col items-stretch gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Input
        type="number"
        value={Number.isFinite(value) ? value : ""}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(event.target.value)}
        className="h-7 text-xs"
      />
    </Label>
  )
}

export function CheckboxRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <Label className="flex items-center gap-2 text-xs text-muted-foreground">
      <input
        type="checkbox"
        className="h-3.5 w-3.5"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </Label>
  )
}
