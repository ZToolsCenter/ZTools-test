# Issue #590 Windows 独立应用启动方案

## 1. 背景

ZTools v2.6.1 使用 Electron 41.4.0，对应 Chromium 146。该版本在 Windows 上执行 `shell.openPath()` 时，最终由 Electron 主进程直接调用 `ShellExecuteExW`。

因此，通过 ZTools 启动的外部程序会保留与 ZTools 的进程启动关系。Windows 任务管理器可能将外部程序归入 ZTools 应用组，并将 CPU、内存和磁盘占用汇总显示在 ZTools 名下。

推荐在 Windows 原生模块中实现一个通过 Explorer COM 接口启动应用的能力：

```text
IShellWindows
  -> Desktop IDispatch
  -> IServiceProvider
  -> IShellBrowser
  -> IShellView
  -> IShellFolderViewDual
  -> IShellDispatch2::ShellExecute
```

启动请求由 Explorer 执行后，新应用的进程关系将不再直接挂在 ZTools 下。

## 2. 实现位置

原生模块仓库：

```text
/Users/zing/Workspace/zTools/ZTools-native-api
```

主要修改文件：

```text
ZTools-native-api/src/binding_windows.cpp
ZTools-native-api/binding.gyp
ZTools/src/main/core/native/index.ts
ZTools/src/main/core/commandLauncher/windowsLauncher.ts
```

## 3. 原生接口设计

建议原生接口接收一个配置对象并返回 Promise：

```ts
interface ExplorerLaunchOptions {
  target: string
  parameters?: string
  workingDirectory?: string
  verb?: string
  showCommand?: number
}

interface ExplorerLaunchResult {
  success: boolean
  hresult: number
  stage: string
}
```

字段说明：

- `target`：`.exe`、`.lnk`、文档路径或协议地址。
- `parameters`：完整的 Windows 参数字符串。
- `workingDirectory`：工作目录；为空时交给 Shell 决定。
- `verb`：Shell 动词；为空时使用默认动词，提权场景可传 `runas`。
- `showCommand`：窗口显示方式，默认使用 `SW_SHOWNORMAL`。
- `hresult`：COM 返回的 HRESULT。
- `stage`：失败步骤，用于日志和问题定位。

`parameters` 建议保留为字符串，不要在 C++ 层接收数组后自行拼接。Windows 命令行参数转义规则复杂，调用方应传递已经构造好的原始参数字符串。

## 4. 编译配置

在 `binding_windows.cpp` 中增加头文件：

```cpp
#include <servprov.h>
#include <shldisp.h>
#include <shlguid.h>
#include <wrl/client.h>
```

在 `binding.gyp` 的 Windows `libraries` 中增加：

```json
"oleaut32.lib"
```

`oleaut32.lib` 用于 `BSTR`、`VARIANT`、`SysAllocStringLen` 和 `VariantClear` 等 COM Automation API。

## 5. Explorer COM 核心实现

以下代码展示核心调用链。生产实现应将该函数放到原生异步 Worker 中执行。

```cpp
using Microsoft::WRL::ComPtr;

struct ExplorerLaunchResult {
    HRESULT hr;
    const char* stage;
};

/**
 * 通过桌面 Explorer 的 Shell COM 接口启动目标。
 * @param target 目标路径、快捷方式或协议地址。
 * @param parameters 传递给目标的原始参数字符串。
 * @param workingDirectory 工作目录，空字符串表示使用 Shell 默认值。
 * @param verb Shell 动词，空字符串表示使用默认动词。
 * @param showCommand 窗口显示方式。
 * @returns 启动受理结果及失败阶段。
 */
ExplorerLaunchResult RunShellExecuteViaExplorer(
    const std::wstring& target,
    const std::wstring& parameters,
    const std::wstring& workingDirectory,
    const std::wstring& verb,
    long showCommand
) {
    ComPtr<IShellWindows> shellWindows;
    HRESULT hr = CoCreateInstance(
        CLSID_ShellWindows,
        nullptr,
        CLSCTX_LOCAL_SERVER,
        IID_PPV_ARGS(&shellWindows)
    );
    if (FAILED(hr)) {
        return {hr, "create-shell-windows"};
    }

    // 获取桌面 Explorer 的 IDispatch，确保启动动作发生在 Explorer 进程。
    VARIANT desktopLocation;
    VariantInit(&desktopLocation);
    desktopLocation.vt = VT_I4;
    desktopLocation.lVal = CSIDL_DESKTOP;

    VARIANT emptyLocation;
    VariantInit(&emptyLocation);

    long explorerHwndValue = 0;
    ComPtr<IDispatch> desktopDispatch;
    hr = shellWindows->FindWindowSW(
        &desktopLocation,
        &emptyLocation,
        SWC_DESKTOP,
        &explorerHwndValue,
        SWFO_NEEDDISPATCH,
        &desktopDispatch
    );
    if (hr == S_FALSE) {
        hr = E_FAIL;
    }
    if (FAILED(hr)) {
        return {hr, "find-desktop-shell"};
    }

    // 允许 Explorer 将新应用或 Shell UI 带到前台。
    DWORD explorerPid = 0;
    const HWND explorerHwnd =
        reinterpret_cast<HWND>(static_cast<LONG_PTR>(explorerHwndValue));
    GetWindowThreadProcessId(explorerHwnd, &explorerPid);
    if (explorerPid != 0) {
        AllowSetForegroundWindow(explorerPid);
    }

    ComPtr<IServiceProvider> serviceProvider;
    hr = desktopDispatch.As(&serviceProvider);
    if (FAILED(hr)) {
        return {hr, "query-service-provider"};
    }

    ComPtr<IShellBrowser> shellBrowser;
    hr = serviceProvider->QueryService(
        SID_STopLevelBrowser,
        IID_PPV_ARGS(&shellBrowser)
    );
    if (FAILED(hr)) {
        return {hr, "query-shell-browser"};
    }

    ComPtr<IShellView> shellView;
    hr = shellBrowser->QueryActiveShellView(&shellView);
    if (FAILED(hr)) {
        return {hr, "query-shell-view"};
    }

    ComPtr<IDispatch> backgroundDispatch;
    hr = shellView->GetItemObject(
        SVGIO_BACKGROUND,
        IID_PPV_ARGS(&backgroundDispatch)
    );
    if (FAILED(hr)) {
        return {hr, "get-shell-background"};
    }

    ComPtr<IShellFolderViewDual> folderView;
    hr = backgroundDispatch.As(&folderView);
    if (FAILED(hr)) {
        return {hr, "query-folder-view"};
    }

    ComPtr<IDispatch> applicationDispatch;
    hr = folderView->get_Application(&applicationDispatch);
    if (FAILED(hr)) {
        return {hr, "get-shell-application"};
    }

    ComPtr<IShellDispatch2> shellDispatch;
    hr = applicationDispatch.As(&shellDispatch);
    if (FAILED(hr)) {
        return {hr, "query-shell-dispatch"};
    }

    // 准备 ShellExecute 的可选参数。
    VARIANT args;
    VARIANT directory;
    VARIANT operation;
    VARIANT show;
    VariantInit(&args);
    VariantInit(&directory);
    VariantInit(&operation);
    VariantInit(&show);

    if (!parameters.empty()) {
        args.vt = VT_BSTR;
        args.bstrVal = SysAllocStringLen(
            parameters.data(),
            static_cast<UINT>(parameters.size())
        );
    }

    if (!workingDirectory.empty()) {
        directory.vt = VT_BSTR;
        directory.bstrVal = SysAllocStringLen(
            workingDirectory.data(),
            static_cast<UINT>(workingDirectory.size())
        );
    }

    if (!verb.empty()) {
        operation.vt = VT_BSTR;
        operation.bstrVal = SysAllocStringLen(
            verb.data(),
            static_cast<UINT>(verb.size())
        );
    }

    show.vt = VT_I4;
    show.lVal = showCommand;

    BSTR file = SysAllocStringLen(
        target.data(),
        static_cast<UINT>(target.size())
    );
    if (file == nullptr) {
        VariantClear(&args);
        VariantClear(&directory);
        VariantClear(&operation);
        VariantClear(&show);
        return {E_OUTOFMEMORY, "allocate-target"};
    }

    // 成功仅表示 Explorer 接受了启动请求，不表示目标程序已完成初始化。
    hr = shellDispatch->ShellExecute(
        file,
        args,
        directory,
        operation,
        show
    );

    SysFreeString(file);
    VariantClear(&args);
    VariantClear(&directory);
    VariantClear(&operation);
    VariantClear(&show);

    return {hr, SUCCEEDED(hr) ? "completed" : "shell-execute"};
}
```

## 6. COM 线程模型

不要假设 Electron 主线程当前使用的 COM apartment 类型。建议使用 `Napi::AsyncWorker` 或等价的 Promise Worker，在 Worker 线程中初始化 STA：

```cpp
HRESULT initHr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
const bool needUninitialize = initHr == S_OK || initHr == S_FALSE;

if (FAILED(initHr)) {
    result = {initHr, "initialize-com"};
    return;
}

result = RunShellExecuteViaExplorer(
    target,
    parameters,
    workingDirectory,
    verb,
    showCommand
);

if (needUninitialize) {
    CoUninitialize();
}
```

约束：

- `S_OK` 和 `S_FALSE` 都必须与 `CoUninitialize()` 配对。
- 遇到 `RPC_E_CHANGED_MODE` 时不应继续执行，也不能调用 `CoUninitialize()`。
- 不建议在 Electron 主线程同步执行 Shell COM 调用，避免文件关联、Mark-of-the-Web 或 Shell UI 阻塞主进程。

## 7. N-API 导出

原生绑定函数负责：

1. 校验 `target` 是否为非空字符串。
2. 读取可选参数。
3. 创建 Promise 和异步 Worker。
4. 在 Worker 中执行 Explorer COM 调用。
5. 将结果解析为 `ExplorerLaunchResult`。

模块初始化处增加：

```cpp
exports.Set(
    "launchViaExplorer",
    Napi::Function::New(env, LaunchViaExplorer)
);
```

推荐失败结果示例：

```json
{
  "success": false,
  "hresult": 2147500037,
  "stage": "query-shell-browser"
}
```

不要仅返回 `boolean`，否则 Windows 实机出现 Explorer COM 兼容问题时难以定位失败位置。

## 8. TypeScript 原生层封装

在 `src/main/core/native/index.ts` 的 `NativeAddon` 中增加：

```ts
launchViaExplorer: (options: ExplorerLaunchOptions) => Promise<ExplorerLaunchResult>
```

建议增加统一封装类：

```ts
export interface ExplorerLaunchOptions {
  target: string
  parameters?: string
  workingDirectory?: string
  verb?: string
  showCommand?: number
}

export interface ExplorerLaunchResult {
  success: boolean
  hresult: number
  stage: string
}

export class WindowsShellLauncher {
  /**
   * 通过 Windows Explorer 的 Shell COM 接口启动目标。
   * @param options 启动目标及 Shell 参数。
   * @returns Explorer 接受启动请求后的结果。
   * @throws 当前平台不是 Windows 或参数无效时抛出异常。
   */
  static launch(options: ExplorerLaunchOptions): Promise<ExplorerLaunchResult> {
    if (platform !== 'win32') {
      throw new Error('launchViaExplorer is only supported on Windows')
    }
    if (!options?.target) {
      throw new TypeError('target must be a non-empty string')
    }
    return (addon as NativeAddon).launchViaExplorer(options)
  }
}
```

## 9. Windows 启动器接入

在 `windowsLauncher.ts` 中为普通应用增加统一辅助函数：

```ts
/**
 * 通过 Explorer 启动 Windows 应用，并在 COM 调用失败时回退 Electron Shell。
 * @param appPath 应用、快捷方式或协议路径。
 * @returns 启动请求完成后的 Promise。
 * @throws Explorer 和 Electron Shell 均无法启动目标时抛出异常。
 */
async function openApplicationViaExplorer(appPath: string): Promise<void> {
  const result = await WindowsShellLauncher.launch({
    target: appPath,
    showCommand: 1
  })

  if (result.success) {
    return
  }

  // Explorer 不可用时保留现有启动能力，但该回退可能继续产生任务管理器分组。
  console.warn('[Launcher] Explorer COM 启动失败，回退 openPath:', result)
  const error = await shell.openPath(appPath)
  if (error) {
    throw new Error(`启动失败: ${error}`)
  }
}
```

建议应用范围：

- `.lnk`：使用新接口，保留快捷方式自身参数和工作目录。
- 绝对路径 `.exe`：使用新接口。
- 应用协议，如 `steam://`：可以使用新接口。
- UWP：继续使用 `IApplicationActivationManager`。
- `.cpl`、`.msc`：第一阶段保持现有逻辑。
- 普通文件和文件夹：第一阶段继续使用 `shell.openPath()`。

本地启动项需要根据 `LocalShortcut.type` 区分：

- `app`：走 `WindowsShellLauncher`。
- `file`、`folder`：继续走 `shell.openPath()`。

## 10. 回退策略

推荐顺序：

```text
Explorer COM ShellExecute
  -> 失败：记录 HRESULT 和 stage
  -> shell.openPath / shell.openExternal
  -> 仍失败：向调用方抛出错误
```

回退日志必须保留：

- `target`
- `hresult`
- `stage`
- 回退 API
- Electron Shell 返回的错误文本

不要把以下方式作为正式实现：

- `spawn(..., { detached: true })`：不会改变 Windows 父进程关系。
- `subprocess.unref()`：只影响 Node.js 事件循环引用。
- `cmd.exe /c start`：存在路径、引号和特殊字符解析问题。
- PowerShell `Start-Process`：存在启动延迟、执行环境和错误反馈问题。
- `PROC_THREAD_ATTRIBUTE_PARENT_PROCESS`：只适用于直接 `CreateProcess`，无法完整替代 `.lnk`、文件关联和协议的 Shell 语义。

## 11. 构建与部署

在 Windows 平台进入原生模块仓库：

```powershell
cd C:\path\to\ZTools-native-api
npm install
npm run build
```

构建结果：

```text
ZTools-native-api/build/Release/ztools_native.node
```

将构建结果更新到：

```text
ZTools/resources/lib/win/ztools_native.node
```

随后重新构建 ZTools：

```powershell
pnpm install
pnpm typecheck:node
pnpm build:win
```

## 12. Windows 验证方案

测试前必须完全退出目标程序，避免 JetBrains、浏览器等单实例程序复用已有进程。

查询目标进程及父进程：

```powershell
Get-CimInstance Win32_Process |
  Where-Object Name -Like '*rustrover*' |
  Select-Object Name, ProcessId, ParentProcessId, CommandLine
```

再查询父进程：

```powershell
Get-Process -Id <ParentProcessId>
```

期望结果：

- 顶层启动进程的父进程为 `explorer.exe`，而不是 ZTools。
- Windows 任务管理器中目标程序作为独立应用显示。
- 目标程序的资源占用不再汇总到 ZTools 应用组。
- 关闭 ZTools 后，目标程序继续运行。

建议测试矩阵：

- `.lnk` 自带参数和工作目录。
- 直接 `.exe`。
- 中文路径和带空格路径。
- 包含 `&`、单引号等特殊字符的路径。
- `steam://` 等应用协议。
- 触发 UAC 的程序。
- UNC 网络路径。
- Explorer 重启后的第一次启动。
- COM 调用失败后的 Electron Shell 回退。
- 已运行的单实例程序。

## 13. API 行为边界

`IShellDispatch2::ShellExecute` 不返回目标程序 PID。`success: true` 只表示 Explorer 已接受启动请求，不表示：

- 目标程序已经完成初始化。
- 目标程序一定创建了新进程。
- 单实例程序没有复用已有进程。
- 目标程序启动后没有自行创建其他进程。

因此，自动化测试应使用专门的测试程序记录自身 PID 和 Parent PID，而不能依赖启动接口返回 PID。

## 14. 后续演进

Electron 43 使用的 Chromium 150 已默认通过 Explorer COM 执行普通文件的 Shell 启动。后续升级 Electron 后，可以评估移除 `.exe` 和 `.lnk` 的自定义实现。

升级后仍应单独验证：

- `shell.openExternal()` 的协议启动行为。
- UAC 和不同完整性级别下的启动行为。
- Explorer COM 不可用时的降级逻辑。
- 自定义原生接口是否仍被协议链接或特殊启动场景依赖。
