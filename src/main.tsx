import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { api } from "./apis.tsx"

const result = api.showWindow().then()
result.then(console.log)
result.catch(console.error)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)