import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App.tsx'
import { showWindow } from './api'
import { AlertProvider, ThemeProvider } from 'flowcloudai-ui'
// @ts-expect-error - CSS import, no types needed
import 'flowcloudai-ui/style';
import './index.css'


const result = showWindow().then()
result.then(console.log)
result.catch(console.error)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
      <ThemeProvider defaultTheme={"system"}>
          <AlertProvider>
              <App/>
          </AlertProvider>
      </ThemeProvider>
  </StrictMode>,
)