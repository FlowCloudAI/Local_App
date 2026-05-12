export interface DockPanelSegmentedOption<T extends string> {
    key: T
    label: string
}

interface DockPanelSegmentedControlProps<T extends string> {
    options: readonly DockPanelSegmentedOption<T>[]
    value: T
    onChange: (value: T) => void
    ariaLabel: string
    className?: string
}

interface DockPanelSearchInputProps {
    value: string
    onChange: (value: string) => void
    placeholder: string
    ariaLabel?: string
    className?: string
}

export function DockPanelSegmentedControl<T extends string>({
    options,
    value,
    onChange,
    ariaLabel,
    className = '',
}: DockPanelSegmentedControlProps<T>) {
    const rootClassName = ['dock-panel-segmented', className].filter(Boolean).join(' ')

    return (
        <div className={rootClassName} role="group" aria-label={ariaLabel}>
            {options.map((item) => (
                <button
                    key={item.key}
                    type="button"
                    className={`dock-panel-segmented__item${value === item.key ? ' is-active' : ''}`}
                    aria-pressed={value === item.key}
                    onClick={() => onChange(item.key)}
                >
                    {item.label}
                </button>
            ))}
        </div>
    )
}

export function DockPanelSearchInput({
    value,
    onChange,
    placeholder,
    ariaLabel = placeholder,
    className = '',
}: DockPanelSearchInputProps) {
    const rootClassName = ['dock-panel-search', className].filter(Boolean).join(' ')

    return (
        <label className={rootClassName}>
            <svg
                className="dock-panel-search__icon"
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
            >
                <circle cx="6" cy="6" r="4"/>
                <path d="M9.2 9.2L12 12"/>
            </svg>
            <input
                className="dock-panel-search__input"
                type="search"
                value={value}
                placeholder={placeholder}
                aria-label={ariaLabel}
                autoComplete="off"
                onChange={(event) => onChange(event.target.value)}
            />
        </label>
    )
}
