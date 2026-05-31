#!/usr/bin/env node

const cp = require('child_process')
const fs = require('fs')
const path = require('path')

const ADB_WAIT_TIMEOUT_MS = 180000
const CHECK_INTERVAL_MS = 3000
const ADB_WAIT_TIMEOUT_SECONDS = Math.round(ADB_WAIT_TIMEOUT_MS / 1000)
const DEV_SERVER_PORTS = [5175, 1421]
const PORT_RELEASE_TIMEOUT_MS = 10000
const PROJECT_ROOT = path.resolve(__dirname, '..')

function existsFile(filePath) {
    try {
        return fs.statSync(filePath).isFile()
    } catch {
        return false
    }
}

function existsDirectory(filePath) {
    try {
        return fs.statSync(filePath).isDirectory()
    } catch {
        return false
    }
}

function compareVersionLike(a, b) {
    const left = a.split(/[^\d]+/).filter(Boolean).map(Number)
    const right = b.split(/[^\d]+/).filter(Boolean).map(Number)
    const length = Math.max(left.length, right.length)

    for (let i = 0; i < length; i += 1) {
        const diff = (left[i] || 0) - (right[i] || 0)
        if (diff !== 0) {
            return diff
        }
    }

    return a.localeCompare(b)
}

function findLatestNdkRoot(sdkRoot) {
    if (!sdkRoot) {
        return null
    }

    const ndkDir = path.join(sdkRoot, 'ndk')
    if (!existsDirectory(ndkDir)) {
        return null
    }

    const versions = fs
        .readdirSync(ndkDir, {withFileTypes: true})
        .filter((item) => item.isDirectory())
        .map((item) => item.name)
        .sort(compareVersionLike)

    const latest = versions[versions.length - 1]
    return latest ? path.join(ndkDir, latest) : null
}

function findAndroidNdkRoot() {
    const explicitCandidates = [
        process.env.ANDROID_NDK_HOME,
        process.env.ANDROID_NDK_ROOT,
        process.env.NDK_HOME,
    ].filter(Boolean)

    for (const candidate of explicitCandidates) {
        if (existsDirectory(candidate)) {
            return candidate
        }
    }

    const sdkCandidates = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT].filter(Boolean)
    for (const sdkRoot of sdkCandidates) {
        const ndkRoot = findLatestNdkRoot(sdkRoot)
        if (ndkRoot) {
            return ndkRoot
        }
    }

    for (const sdkRoot of sdkCandidates) {
        const bundledRoot = path.join(sdkRoot, 'ndk-bundle')
        if (existsDirectory(bundledRoot)) {
            return bundledRoot
        }
    }

    return null
}

function findNdkHostBin(ndkRoot) {
    const prebuiltRoot = path.join(ndkRoot, 'toolchains', 'llvm', 'prebuilt')
    if (!existsDirectory(prebuiltRoot)) {
        return null
    }

    const preferredHosts =
        process.platform === 'win32'
            ? ['windows-x86_64', 'windows']
            : process.platform === 'darwin'
              ? ['darwin-x86_64', 'darwin-arm64']
              : ['linux-x86_64']

    for (const host of preferredHosts) {
        const candidate = path.join(prebuiltRoot, host, 'bin')
        if (existsDirectory(candidate)) {
            return candidate
        }
    }

    const fallbackHost = fs.readdirSync(prebuiltRoot, {withFileTypes: true}).find((item) => item.isDirectory())
    return fallbackHost ? path.join(prebuiltRoot, fallbackHost.name, 'bin') : null
}

function findNdkExecutable(binDir, baseName) {
    const candidates =
        process.platform === 'win32'
            ? [`${baseName}.cmd`, `${baseName}.exe`, baseName]
            : [baseName]

    for (const candidate of candidates) {
        const full = path.join(binDir, candidate)
        if (existsFile(full)) {
            return full
        }
    }

    return null
}

function configureAndroidNdkBuildEnv(baseEnv) {
    const ndkRoot = findAndroidNdkRoot()
    if (!ndkRoot) {
        throw new Error('未找到 Android NDK，请先安装 NDK 并设置 ANDROID_NDK_HOME、ANDROID_NDK_ROOT 或 ANDROID_HOME。')
    }

    const binDir = findNdkHostBin(ndkRoot)
    if (!binDir) {
        throw new Error(`未找到 Android NDK LLVM 工具链目录: ${ndkRoot}`)
    }

    const apiLevel = process.env.ANDROID_NDK_API_LEVEL || '26'
    const llvmAr = findNdkExecutable(binDir, 'llvm-ar')
    const llvmRanlib = findNdkExecutable(binDir, 'llvm-ranlib')
    const targets = [
        {rust: 'aarch64-linux-android', clang: `aarch64-linux-android${apiLevel}-clang`},
        {rust: 'armv7-linux-androideabi', clang: `armv7a-linux-androideabi${apiLevel}-clang`},
        {rust: 'i686-linux-android', clang: `i686-linux-android${apiLevel}-clang`},
        {rust: 'x86_64-linux-android', clang: `x86_64-linux-android${apiLevel}-clang`},
    ]

    const env = {
        ...baseEnv,
        ANDROID_NDK_HOME: ndkRoot,
        ANDROID_NDK_ROOT: ndkRoot,
        PATH: [binDir, baseEnv.PATH || process.env.PATH || ''].filter(Boolean).join(path.delimiter),
    }

    for (const target of targets) {
        const cc = findNdkExecutable(binDir, target.clang)
        const cxx = findNdkExecutable(binDir, `${target.clang}++`)
        if (!cc || !cxx) {
            throw new Error(`Android NDK 缺少 ${target.rust} 编译器，请检查 NDK 安装: ${binDir}`)
        }

        const suffix = target.rust.replace(/-/g, '_')
        const cargoSuffix = suffix.toUpperCase()

        env[`CC_${target.rust}`] = cc
        env[`CC_${suffix}`] = cc
        env[`CXX_${target.rust}`] = cxx
        env[`CXX_${suffix}`] = cxx
        env[`CARGO_TARGET_${cargoSuffix}_LINKER`] = cc

        if (llvmAr) {
            env[`AR_${target.rust}`] = llvmAr
            env[`AR_${suffix}`] = llvmAr
        }
        if (llvmRanlib) {
            env[`RANLIB_${target.rust}`] = llvmRanlib
            env[`RANLIB_${suffix}`] = llvmRanlib
        }
    }

    console.log(`使用 Android NDK 编译器环境: ${ndkRoot}`)
    return env
}

function findExecutable(name) {
    const isWin = process.platform === 'win32'
    const exts = isWin ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';') : ['']
    const candidates = new Set()

    const addPath = (p) => {
        if (!p) {
            return
        }
        const candidate = path.resolve(p)
        if (!candidate) {
            return
        }
        candidates.add(candidate)
    }

    const rootCandidates = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT].filter(Boolean)
    const extraPaths = []
    for (const root of rootCandidates) {
        extraPaths.push(path.join(root, 'platform-tools'))
        extraPaths.push(path.join(root, 'emulator'))
    }

    ;[...extraPaths, ...(process.env.PATH || '').split(path.delimiter)]
        .filter(Boolean)
        .forEach(addPath)

    for (const dir of candidates) {
        for (const ext of exts) {
            const full = path.join(dir, isWin && !path.extname(name) ? `${name}${ext}` : name)
            if (existsFile(full)) {
                return full
            }
        }
    }

    return null
}

function runCapture(cmd, args = [], env = process.env) {
    const result = cp.spawnSync(cmd, args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env,
    })
    if (result.error) {
        throw result.error
    }
    if (result.status !== 0) {
        const stderr = (result.stderr || '').trim()
        const stdout = (result.stdout || '').trim()
        const msg = [stderr, stdout].filter(Boolean).join('\n') || `命令返回码 ${result.status}`
        throw new Error(`执行失败: ${cmd} ${args.join(' ')}\n${msg}`)
    }
    return (result.stdout || '').toString()
}

function normalizeForMatch(value) {
    return value.replace(/\\/g, '/').toLowerCase()
}

function getWindowsListeningProcesses(ports) {
    const portSet = new Set(ports.map((port) => String(port)))
    const output = runCapture('netstat', ['-ano', '-p', 'tcp'])
    const items = []

    for (const line of output.split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/)
        if (parts.length < 5 || parts[0].toUpperCase() !== 'TCP') {
            continue
        }

        const [, localAddress, , state, pid] = parts
        if (state.toUpperCase() !== 'LISTENING') {
            continue
        }

        const match = localAddress.match(/:(\d+)$/)
        if (!match || !portSet.has(match[1])) {
            continue
        }

        items.push({pid: Number(pid), port: Number(match[1])})
    }

    return items
}

function getUnixListeningProcesses(ports) {
    const items = []

    for (const port of ports) {
        try {
            const output = runCapture('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'])
            for (const line of output.split(/\r?\n/)) {
                if (line.startsWith('p')) {
                    items.push({pid: Number(line.slice(1)), port})
                }
            }
        } catch {
            // 非 Windows 环境没有 lsof 时跳过预检查，交给 Vite 输出原始错误。
        }
    }

    return items
}

function getListeningProcesses(ports) {
    const rawItems = process.platform === 'win32' ? getWindowsListeningProcesses(ports) : getUnixListeningProcesses(ports)
    const byPid = new Map()

    for (const item of rawItems) {
        if (!Number.isFinite(item.pid)) {
            continue
        }

        const existing = byPid.get(item.pid) || {pid: item.pid, ports: new Set()}
        existing.ports.add(item.port)
        byPid.set(item.pid, existing)
    }

    return [...byPid.values()].map((item) => ({
        pid: item.pid,
        ports: [...item.ports].sort((a, b) => a - b),
        commandLine: getProcessCommandLine(item.pid),
    }))
}

function getProcessCommandLine(pid) {
    try {
        if (process.platform === 'win32') {
            return runCapture('powershell.exe', [
                '-NoProfile',
                '-Command',
                `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; (Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`,
            ]).trim()
        }

        return runCapture('ps', ['-p', String(pid), '-o', 'command=']).trim()
    } catch {
        return ''
    }
}

function isCurrentProjectViteProcess(commandLine) {
    const normalizedCommand = normalizeForMatch(commandLine || '')
    const normalizedRoot = normalizeForMatch(PROJECT_ROOT)

    return normalizedCommand.includes(normalizedRoot) && normalizedCommand.includes('/vite/bin/vite.js')
}

function formatPortConflict(item) {
    const ports = item.ports.map((port) => `:${port}`).join(', ')
    const command = item.commandLine ? `，命令：${item.commandLine}` : ''
    return `PID ${item.pid} (${ports})${command}`
}

async function waitForPortsReleased(ports, timeoutMs = PORT_RELEASE_TIMEOUT_MS) {
    const start = Date.now()

    while (Date.now() - start < timeoutMs) {
        if (!getListeningProcesses(ports).length) {
            return true
        }

        await new Promise((resolve) => {
            setTimeout(resolve, 300)
        })
    }

    return !getListeningProcesses(ports).length
}

async function prepareDevServerPorts() {
    const conflicts = getListeningProcesses(DEV_SERVER_PORTS)
    if (!conflicts.length) {
        return
    }

    const staleViteProcesses = conflicts.filter((item) => isCurrentProjectViteProcess(item.commandLine))
    const otherProcesses = conflicts.filter((item) => !isCurrentProjectViteProcess(item.commandLine))

    if (otherProcesses.length) {
        throw new Error(
            [
                `端口 ${DEV_SERVER_PORTS.join('/')} 已被其他进程占用，Vite 无法启动。`,
                ...otherProcesses.map((item) => `- ${formatPortConflict(item)}`),
                '请关闭这些进程后重试。',
            ].join('\n')
        )
    }

    console.log(
        `发现本项目遗留的 Vite dev server 占用端口 ${DEV_SERVER_PORTS.join('/')}，正在关闭旧进程：` +
        staleViteProcesses.map((item) => item.pid).join(', ')
    )

    for (const item of staleViteProcesses) {
        try {
            process.kill(item.pid)
        } catch (error) {
            if (error.code !== 'ESRCH') {
                throw error
            }
        }
    }

    if (!(await waitForPortsReleased(DEV_SERVER_PORTS))) {
        throw new Error(`旧 Vite 进程关闭后端口 ${DEV_SERVER_PORTS.join('/')} 仍未释放，请手动检查占用进程。`)
    }
}

function parseDevices(output) {
    const lines = output.trim().split(/\r?\n/).slice(1)
    const devices = []
    for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) {
            continue
        }
        const [serial, state] = trimmed.split(/\s+/)
        if (serial === 'List' || serial === '*' || !state) {
            continue
        }
        devices.push({serial, state})
    }
    return devices
}

async function waitForDevice(adbPath, timeoutMs = ADB_WAIT_TIMEOUT_MS) {
    const start = Date.now()
    let warnedUnauthorized = false
    let warnedOffline = false

    while (Date.now() - start < timeoutMs) {
        const list = parseDevices(runCapture(adbPath, ['devices']))
        const ready = list.find((item) => item.state === 'device')
        if (ready) {
            return ready.serial
        }

        const hasUnauthorized = list.some((item) => item.state === 'unauthorized')
        const hasOffline = list.some((item) => item.state === 'offline')

        if (hasUnauthorized && !warnedUnauthorized) {
            console.log('发现设备未授权：如为真机请确认已在手机上允许 USB 调试。')
            warnedUnauthorized = true
        }
        if (hasOffline && !warnedOffline) {
            console.log('发现设备状态为 offline，等待设备恢复。')
            warnedOffline = true
        }

        await new Promise((resolve) => {
            setTimeout(resolve, CHECK_INTERVAL_MS)
        })
    }

    return null
}

function listAvds(emulatorPath) {
    const output = runCapture(emulatorPath, ['-list-avds'])
    return output
        .split(/\r?\n/)
        .map((name) => name.trim())
        .filter(Boolean)
}

function startEmulator(emulatorPath, avdName) {
    console.log(`未检测到已连接设备，准备启动模拟器：${avdName}`)
    const child = cp.spawn(emulatorPath, ['-avd', avdName], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
    })
    child.unref()
}

function startServerIfNeeded(adbPath) {
    try {
        runCapture(adbPath, ['start-server'])
    } catch {
        // 无需中断流程：后续命令会再触发更准确错误
    }
}

async function main() {
    const adbPath = findExecutable('adb')
    if (!adbPath) {
        throw new Error('未找到 adb，请先确认 Android SDK platform-tools 已加入 PATH 或设置 ANDROID_HOME/ANDROID_SDK_ROOT。')
    }

    await prepareDevServerPorts()

    const emulatorPath = findExecutable('emulator')
    startServerIfNeeded(adbPath)
    let devices = parseDevices(runCapture(adbPath, ['devices']))
    let serial = devices.find((item) => item.state === 'device')

    if (!serial) {
        if (!emulatorPath) {
            throw new Error('未检测到已连接设备且未找到 emulator 命令，无法自动启动模拟器。')
        }

        const avds = listAvds(emulatorPath)
        if (!avds.length) {
            throw new Error('未找到可用的 AVD。请先在 Android Studio 创建并配置虚拟机。')
        }

        const targetAvd = process.env.ANDROID_AVD_NAME || avds[0]
        const exists = avds.includes(targetAvd)
        if (!exists) {
            throw new Error(
                `未找到指定 AVD: ${targetAvd}。可用 AVD: ${avds.join(', ')}。可设置 ANDROID_AVD_NAME 环境变量指定。`
            )
        }

        startEmulator(emulatorPath, targetAvd)
        serial = await waitForDevice(adbPath)
        if (!serial) {
            throw new Error(
                `启动模拟器后在 ${ADB_WAIT_TIMEOUT_SECONDS}s 内未检测到可用设备。请检查 adb 环境和 Android Studio。`
            )
        }
    } else {
        serial = serial.serial
    }

    console.log(`检测到设备就绪: ${serial}`)

    runCapture(adbPath, ['-s', serial, 'reverse', '--remove-all'])
    runCapture(adbPath, ['-s', serial, 'reverse', 'tcp:5175', 'tcp:5175'])
    runCapture(adbPath, ['-s', serial, 'reverse', 'tcp:1421', 'tcp:1421'])

    const runEnv = configureAndroidNdkBuildEnv({
        ...process.env,
        CARGO_PROFILE_DEV_DEBUG: '0',
        CARGO_PROFILE_DEV_STRIP: 'debuginfo',
    })

    const npmArgs = ['run', 'tauri', '--', 'android', 'dev', '--host', '127.0.0.1']
    const result =
        process.platform === 'win32'
            ? cp.spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'npm', ...npmArgs], {
                stdio: 'inherit',
                windowsHide: true,
                env: runEnv,
            })
            : cp.spawnSync('npm', npmArgs, {
                stdio: 'inherit',
                windowsHide: true,
                env: runEnv,
            })

    if (result.error) {
        throw result.error
    }
    if (result.status !== 0) {
        throw new Error(`tauri android dev 执行失败，退出码: ${result.status}`)
    }
}

main().catch((error) => {
    console.error(error.message || error)
    process.exitCode = 1
})
