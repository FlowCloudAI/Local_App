import './App.css'
import "./api"
import {Button, SideBar, type SideBarItem, TabBar, type TabItem} from 'flowcloudai-ui'
import {getCurrentWindow} from "@tauri-apps/api/window";
import {type CSSProperties, useState, useEffect} from "react";

function App() {
    const win = getCurrentWindow();

    const [isMaximized, setIsMaximized] = useState(false);
    useEffect(() => {
        win.isMaximized().then(setIsMaximized);
        const unlisten = win.onResized(() => win.isMaximized().then(setIsMaximized));
        return () => {
            unlisten.then(f => f());
        };
    }, [win]);

    // Tabs 相关状态
    const [tabs, setTabs] = useState<TabItem[]>([]);
    const [activeKey, setActiveKey] = useState('1');

    // 新增标签
    const handleAdd = () => {
        const newKey = String(tabs.length + 1);
        setTabs([
            ...tabs,
            {
                key: newKey,
                label: `标签${newKey}`,
                closable: true,
            }
        ]);
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

    // 侧边栏相关状态
    const HomeIcon = (<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1V9.5z" strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round"/>
    </svg>)
    const SearchIcon = (<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <circle cx="11" cy="11" r="7" strokeWidth="1.5"/>
        <path d="M16.5 16.5L21 21" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>)
    const UserIcon = (<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="8" r="4" strokeWidth="1.5"/>
        <path d="M20 21a8 8 0 00-16 0" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>)
    const SettingsIcon = (<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="3" strokeWidth="1.5"/>
        <path
            d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15 1.65 1.65 0 003.17 14H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68 1.65 1.65 0 0010 3.17V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"
            strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>)

    const menuItems: SideBarItem[] = [
        {key: 'home', label: '首页', icon: HomeIcon},
        {key: 'search', label: '搜索', icon: SearchIcon},
        {key: 'profile', label: '个人', icon: UserIcon},
    ]
    const bottomItems: SideBarItem[] = [
        {key: 'settings', label: '设置', icon: SettingsIcon},
    ]

    const [selectedKey, setSelectedKey] = useState('home')
    const [collapsed, setCollapsed] = useState(false)

    return (
        <div className="app-layout">
            <div className="top-bar" data-tauri-drag-region>
                <button className="menu-btn" data-tauri-drag-region>
                    <svg data-tauri-drag-region
                         xmlns="http://www.w3.org/2000/svg" width="512" height="512"
                         viewBox="0 0 512 512" fill="none">
                        <path
                            d="M362.34 234.141C324.97 212.705 258.916 226.767 258.728 286.513C241.793 230.641 315.033 173.27 382.462 199.768C418.083 213.767 439.643 242.766 447.642 275.326C466.139 350.384 405.459 389.506 333.594 385.944C280.288 383.319 255.541 352.071 218.108 330.823C209.484 325.885 195.674 319.011 183.3 317.948C158.178 315.824 141.743 322.386 127.37 331.323C146.742 310.511 174.926 298.637 199.611 299.45C245.105 300.949 277.101 334.072 324.032 335.76C407.397 342.947 405.834 259.14 362.277 234.141L362.34 234.141ZM209.984 134.21C241.48 117.024 281.1 118.149 312.534 136.522C322.47 142.335 340.718 157.271 344.967 168.02C336.093 160.271 318.033 142.772 268.227 150.709C227.982 157.146 199.673 199.206 202.298 236.453C177.488 234.079 152.304 232.454 131.119 254.202C117.183 268.514 106.497 290.263 108.059 316.886C109.434 340.384 125.557 360.508 142.118 369.695C151.992 375.132 162.615 378.445 174.676 380.007C189.924 382.007 216.421 378.882 232.106 370.57C164.053 410.443 85.9373 384.632 66.5022 332.26C46.6298 278.701 82.3752 217.205 144.93 211.955C152.179 211.33 155.429 211.018 159.366 211.33C167.74 170.27 178.926 151.146 209.922 134.21L209.984 134.21Z"
                            fill="url(#linear_fill_jAZk9lqyiGGO3cP1dJ5WO)"/>
                        <defs>
                            <linearGradient id="linear_fill_jAZk9lqyiGGO3cP1dJ5WO" x1="94.38400268554688"
                                            y1="140.4921875"
                                            x2="417.6159973144531" y2="371.5078125" gradientUnits="userSpaceOnUse">
                                <stop offset="0" stop-color="#0DBDED"/>
                                <stop offset="1" stop-color="#9C1FED"/>
                            </linearGradient>
                        </defs>
                    </svg>
                </button>
                <div className={"tab-bar-wrapper"} data-tauri-drag-region>
                    <TabBar
                        background={"transparent"}
                        variant={"floating"}
                        tabRadius={"md"}
                        closable
                        draggable
                        addable
                        fillWidth={false}
                        tauriDragRegion
                        minTabWidth={"10rem"}
                        items={tabs}
                        activeKey={activeKey}
                        onReorder={setTabs}
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
                </div>
                <div className="top-bar-actions" data-tauri-drag-region>
                    <Button
                        variant="ghost"
                        onClick={() => win.minimize()}
                        style={{'--btn-bg-hover': 'var(--fc-color-bg-elevated)'} as CSSProperties}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                             fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                             strokeLinejoin="round">
                            <line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                    </Button>
                    <Button
                        variant="ghost"
                        onClick={() => win.toggleMaximize()}
                        style={{'--btn-bg-hover': 'var(--fc-color-bg-elevated)'} as CSSProperties}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                             fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                             strokeLinejoin="round">
                            {isMaximized ? (
                                <>
                                    <rect x="2" y="6" width="16" height="12" rx="2"/>
                                    <path d="M 6 2 L 20 2 A 2 2 0 0 1 22 4 L 22 13"/>
                                </>
                            ) : (
                                <rect x="3" y="4.5" width="18" height="15" rx="3"/>
                            )}
                        </svg>
                    </Button>
                    <Button
                        variant="ghost"
                        onClick={() => win.close()}
                        style={{'--btn-bg-hover': '#f00'} as CSSProperties}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                             fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                             strokeLinejoin="round">
                            <line x1="19" y1="5" x2="5" y2="19"/>
                            <line x1="5" y1="5" x2="19" y2="19"/>
                        </svg>
                    </Button>
                </div>
            </div>
            <div className="main-content">
                <SideBar
                    items={menuItems}
                    bottomItems={bottomItems}
                    selectedKey={selectedKey}
                    collapsed={collapsed}
                    width={150}
                    onSelect={setSelectedKey}
                    onCollapse={setCollapsed}
                />
            </div>
        </div>
    )
}

export default App
