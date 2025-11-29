import {useState} from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'
import My from './Components/main.tsx';
import {api} from "./apis.tsx"

function App() {
    const [count, setCount] = useState(0);
    const [buttonText, setButtonText] = useState('点我');

    async function handleClick() {
        if (buttonText === '点我')
            setButtonText('加载中...')  // 先显示"加载中"

        const result = await api.testCommand()  // 等待 Rust 返回
        setButtonText(result.success ? result.data : result.error)  // 更新菜单，React 自动改按钮文字
    }

    return (
        <>
            <div>
                <a href="https://vite.dev" target="_blank">
                    <img src={viteLogo} className="logo" alt="Vite logo"/>
                </a>
                <a href="https://react.dev" target="_blank">
                    <img src={reactLogo} className="logo react" alt="React logo"/>
                </a>
            </div>
            <h1>Vite + React</h1>
            <div className="card">
                <button onClick={() => setCount((count) => count + 1)}>
                    count is {count}
                </button>
                <p>
                    Edit <code>src/App.tsx</code> and save to test HMR
                </p>
            </div>
            <p>
                <My.Button text={buttonText} click={handleClick}/>
            </p>
            <p className="read-the-docs">
                Click on the Vite and React logos to learn more
            </p>
        </>
    )
}

export default App
