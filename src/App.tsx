import './App.css'
import "./api"
import {Button, TabBar} from 'flowcloudai-ui'
import {getCurrentWindow} from "@tauri-apps/api/window";
import MDEditor from '@uiw/react-md-editor'
import {useState} from "react";
import * as React from "react";

function App() {
    const win = getCurrentWindow();

    // Tabs 相关状态
    const [tabs, setTabs] = useState([
        {key: '1', label: '标签1', content: <div>内容1</div>},
        {key: '2', label: '标签2', content: <div>内容2</div>},
        {key: '3', label: '标签3', content: <div>内容3</div>},
    ]);
    const [activeKey, setActiveKey] = useState('1');
    const [tabCount, setTabCount] = useState(3);

    // 新增标签
    const handleAdd = () => {
        const newKey = String(tabCount + 1);
        setTabs([
            ...tabs,
            {
                key: newKey,
                label: `标签${newKey}`,
                content: <div>新增内容{newKey}</div>
            }
        ]);
        setTabCount(tabCount + 1);
        setActiveKey(newKey);
    };

    // 删除标签
    const handleClose = (key: string) => {
        const newTabs = tabs.filter(tab => tab.key !== key);
        setTabs(newTabs);

        if (activeKey === key) {
            const closedIndex = tabs.findIndex(tab => tab.key === key);
            const nextTab = newTabs[closedIndex] || newTabs[closedIndex - 1];
            if (nextTab) {
                setActiveKey(nextTab.key);
            }
        }
    };

    return (
        <div className="app-layout">
            <div className="top-bar" data-tauri-drag-region>
                <button className="menu-btn" onClick={() => setPage("settings")}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
                         fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="3" y1="6" x2="21" y2="6"/>
                        <line x1="3" y1="12" x2="21" y2="12"/>
                        <line x1="3" y1="18" x2="21" y2="18"/>
                    </svg>
                </button>
                <div className="top-bar-title" data-tauri-drag-region>流云AI</div>
                <TabBar
                    data-tauri-drag-region
                    radius="md"
                    closable
                    addable
                    items={tabs}
                    activeKey={activeKey}
                    onChange={(key) => {
                        console.log('切换到:', key);
                        setActiveKey(key);
                    }}
                    onClose={(key) => {
                        console.log('关闭:', key);
                        handleClose(key);
                    }}
                    onAdd={() => {
                        console.log('新增标签页');
                        handleAdd();
                    }}
                />
                <div className="top-bar-actions">
                    <Button variant="ghost" onClick={() => win.minimize()}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                             fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                             strokeLinejoin="round">
                            <line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                    </Button>
                    <Button variant="ghost" onClick={() => win.toggleMaximize()}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                             fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                             strokeLinejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="2"/>
                        </svg>
                    </Button>
                    <Button style={{'--btn-bg-hover': '#f00'} as React.CSSProperties} variant="ghost" onClick={() => win.close()}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                             fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                             strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </Button>
                </div>
            </div>

            <MDEditor
                contentEditable={true}
                value={"# Hello World"}
            />
        </div>
    )
}

export default App
