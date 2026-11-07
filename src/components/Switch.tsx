export function Switch(props: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      aria-disabled={props.disabled}
      onClick={() => !props.disabled && props.onChange?.(!props.checked)}
    >
      <span className="switch__knob" />
    </button>
  );
}
