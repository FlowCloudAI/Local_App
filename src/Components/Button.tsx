import {type ReactNode} from "react";
import './Button.css'
import cn from 'classnames'

interface ButtonProps {
    id?: string
    text?: string
    click?: () => void
    children?: ReactNode
    variant?: string
    className?: string
}
export default function Button({id, text, click, children, variant, className}: ButtonProps) {
    const content = children ?? (
        <>
            <p>{text || 'Click Me'}</p>
        </>
    );
    const buttonClasses = cn(
        'button',
        variant && `button-${variant}`,
        className
    );

    return (
        <button id={id} onClick={click} className={buttonClasses}>
            {content}
        </button>
    );
}