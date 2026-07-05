import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  CLEAR_RECYCLE_BIN_CONFIRM,
  KILL_PROCESS_CONFIRM,
  SET_HIBERNATION_CONFIRM,
  START_COMPONENT_CLEANUP_CONFIRM,
  sshHost,
} from './config.js';
import { errorResponse, jsonResponse, toErrorMessage } from './response.js';
import { psString, psStringArray, runPowerShell, runPowerShellJson } from './ssh.js';

const WindowsPathSchema = z
  .string()
  .min(2)
  .max(4096)
  .refine((value) => /^[A-Za-z]:\\/.test(value), 'Expected an absolute Windows path like C:\\Users')
  .refine((value) => !/[\r\n]/.test(value), 'Path must not contain newlines');

const DriveSchema = z
  .string()
  .regex(/^[A-Za-z]:$/, 'Expected a drive like C:')
  .transform((value) => value.toUpperCase());

const SIZE_OF_TREE_FUNCTION = String.raw`
function SizeOfTree($path) {
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  try {
    $rootItem = Get-Item -LiteralPath $path -Force
    if (($rootItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      return [pscustomobject]@{
        Path = $path
        SizeGB = $null
        Files = 0
        Dirs = 0
        Skipped = 0
        IsReparse = $true
        Target = ($rootItem.Target -join ', ')
      }
    }
  } catch { return $null }

  $total = [int64]0
  $files = 0
  $dirs = 0
  $skipped = 0
  $stack = New-Object System.Collections.Stack
  [void]$stack.Push($path)

  while ($stack.Count -gt 0) {
    $p = [string]$stack.Pop()
    try {
      foreach ($f in [System.IO.Directory]::EnumerateFiles($p)) {
        try {
          $fi = New-Object System.IO.FileInfo($f)
          $total += [int64]$fi.Length
          $files += 1
        } catch { $skipped += 1 }
      }
    } catch { $skipped += 1 }

    try {
      foreach ($d in [System.IO.Directory]::EnumerateDirectories($p)) {
        try {
          $di = New-Object System.IO.DirectoryInfo($d)
          if (($di.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) {
            $dirs += 1
            [void]$stack.Push($d)
          }
        } catch { $skipped += 1 }
      }
    } catch { $skipped += 1 }
  }

  [pscustomobject]@{
    Path = $path
    SizeGB = [math]::Round($total / 1GB, 2)
    Files = $files
    Dirs = $dirs
    Skipped = $skipped
    IsReparse = $false
    Target = $null
  }
}
`;

const DISK_STATE_FUNCTION = String.raw`
function DiskState($label) {
  $d = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
  [pscustomobject]@{
    Label = $label
    SizeGB = [math]::Round($d.Size / 1GB, 2)
    FreeGB = [math]::Round($d.FreeSpace / 1GB, 2)
    UsedGB = [math]::Round(($d.Size - $d.FreeSpace) / 1GB, 2)
    UsedPct = [math]::Round((1 - ($d.FreeSpace / $d.Size)) * 100, 1)
  }
}
`;

export function registerSobornyTools(server: McpServer): void {
  server.tool('pc_ping', 'Check SSH and PowerShell connectivity to the Soborny PC.', {}, async () => {
    return runJsonTool(async () => {
      return runPowerShellJson(String.raw`
[pscustomobject]@{
  Host = $env:COMPUTERNAME
  User = $env:USERNAME
  Time = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  SshAlias = ${psString(sshHost())}
} | ConvertTo-Json -Depth 4
`);
    });
  });

  server.tool(
    'pc_summary',
    'Return bounded Windows host summary: OS, uptime, RAM, pagefile, disks, GPU, and top processes by memory.',
    {
      topProcesses: z.number().int().min(1).max(50).optional().default(10),
    },
    async ({ topProcesses }) => {
      return runJsonTool(async () => {
        return runPowerShellJson(String.raw`
$cs = Get-CimInstance Win32_ComputerSystem
$os = Get-CimInstance Win32_OperatingSystem
$page = Get-CimInstance Win32_PageFileUsage
$disks = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {
  [pscustomobject]@{
    Drive = $_.DeviceID
    SizeGB = [math]::Round($_.Size / 1GB, 2)
    FreeGB = [math]::Round($_.FreeSpace / 1GB, 2)
    UsedGB = [math]::Round(($_.Size - $_.FreeSpace) / 1GB, 2)
    UsedPct = [math]::Round((1 - ($_.FreeSpace / $_.Size)) * 100, 1)
    FileSystem = $_.FileSystem
  }
}
$gpus = Get-CimInstance Win32_VideoController | ForEach-Object {
  [pscustomobject]@{
    Name = $_.Name
    AdapterRAMGB = $(if ($_.AdapterRAM) { [math]::Round($_.AdapterRAM / 1GB, 2) } else { $null })
    DriverVersion = $_.DriverVersion
  }
}
$processes = Get-Process | Sort-Object PrivateMemorySize64 -Descending | Select-Object -First ${topProcesses} | ForEach-Object {
  [pscustomobject]@{
    ProcessName = $_.ProcessName
    Id = $_.Id
    WorkingSetGB = [math]::Round($_.WorkingSet64 / 1GB, 2)
    PrivateMemoryGB = [math]::Round($_.PrivateMemorySize64 / 1GB, 2)
    CPUSeconds = $(if ($_.CPU) { [math]::Round($_.CPU, 1) } else { $null })
    StartTime = $(try { $_.StartTime.ToString('yyyy-MM-dd HH:mm:ss') } catch { $null })
  }
}
[pscustomobject]@{
  Host = $env:COMPUTERNAME
  User = $env:USERNAME
  OS = $os.Caption
  OSVersion = $os.Version
  LastBootTime = $os.LastBootUpTime.ToString('yyyy-MM-dd HH:mm:ss')
  TotalRAMGB = [math]::Round($cs.TotalPhysicalMemory / 1GB, 2)
  FreeRAMGB = [math]::Round(($os.FreePhysicalMemory * 1KB) / 1GB, 2)
  TotalVirtualGB = [math]::Round(($os.TotalVirtualMemorySize * 1KB) / 1GB, 2)
  FreeVirtualGB = [math]::Round(($os.FreeVirtualMemory * 1KB) / 1GB, 2)
  PageFiles = $page | ForEach-Object {
    [pscustomobject]@{
      Name = $_.Name
      AllocatedGB = [math]::Round($_.AllocatedBaseSize / 1024, 2)
      CurrentUsageGB = [math]::Round($_.CurrentUsage / 1024, 2)
      PeakUsageGB = [math]::Round($_.PeakUsage / 1024, 2)
    }
  }
  Disks = $disks
  GPUs = $gpus
  TopProcessesByPrivateMemory = $processes
} | ConvertTo-Json -Depth 6
`);
      });
    },
  );

  server.tool(
    'disk_report',
    'Report disk usage for one Windows drive: top root directories, root files, and optional user-profile breakdown.',
    {
      drive: DriveSchema.optional().default('C:'),
      top: z.number().int().min(1).max(50).optional().default(25),
      includeUserBreakdown: z.boolean().optional().default(true),
    },
    async ({ drive, top, includeUserBreakdown }) => {
      return runJsonTool(async () => {
        const root = `${drive}\\`;
        return runPowerShellJson(
          String.raw`
${SIZE_OF_TREE_FUNCTION}
$root = ${psString(root)}
$volume = Get-CimInstance Win32_LogicalDisk -Filter ${psString(`DeviceID='${drive}'`)}
$topRootDirs = Get-ChildItem -LiteralPath $root -Force -Directory | ForEach-Object { SizeOfTree $_.FullName } | Where-Object { $_ -and -not $_.IsReparse } | Sort-Object SizeGB -Descending | Select-Object -First ${top}
$rootFiles = Get-ChildItem -LiteralPath $root -Force -File | Sort-Object Length -Descending | Select-Object -First ${top} | ForEach-Object {
  [pscustomobject]@{
    Path = $_.FullName
    SizeGB = [math]::Round($_.Length / 1GB, 2)
    LastWriteTime = $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
  }
}
$userBreakdown = @()
if (${includeUserBreakdown ? '$true' : '$false'} -and (Test-Path -LiteralPath "${drive}\Users")) {
  $userBreakdown = Get-ChildItem -LiteralPath "${drive}\Users" -Force -Directory | ForEach-Object { SizeOfTree $_.FullName } | Where-Object { $_ -and -not $_.IsReparse } | Sort-Object SizeGB -Descending | Select-Object -First ${top}
}
[pscustomobject]@{
  Drive = ${psString(drive)}
  Volume = [pscustomobject]@{
    SizeGB = [math]::Round($volume.Size / 1GB, 2)
    FreeGB = [math]::Round($volume.FreeSpace / 1GB, 2)
    UsedGB = [math]::Round(($volume.Size - $volume.FreeSpace) / 1GB, 2)
    UsedPct = [math]::Round((1 - ($volume.FreeSpace / $volume.Size)) * 100, 1)
    FileSystem = $volume.FileSystem
  }
  TopRootDirectories = $topRootDirs
  RootFiles = $rootFiles
  Users = $userBreakdown
} | ConvertTo-Json -Depth 7
`,
          { timeoutMs: 300000, maxBuffer: 20 * 1024 * 1024 },
        );
      });
    },
  );

  server.tool(
    'directory_usage',
    'Report immediate child directory and file sizes under a Windows path. Does not follow junctions/reparse points.',
    {
      path: WindowsPathSchema.default('C:\\Users\\info'),
      top: z.number().int().min(1).max(100).optional().default(30),
      includeFiles: z.boolean().optional().default(true),
    },
    async ({ path, top, includeFiles }) => {
      return runJsonTool(async () => {
        return runPowerShellJson(
          String.raw`
${SIZE_OF_TREE_FUNCTION}
$target = ${psString(path)}
if (-not (Test-Path -LiteralPath $target)) {
  [pscustomobject]@{ Path = $target; Exists = $false } | ConvertTo-Json -Depth 4
  exit
}
$dirs = Get-ChildItem -LiteralPath $target -Force -Directory | ForEach-Object { SizeOfTree $_.FullName } | Where-Object { $_ -and -not $_.IsReparse } | Sort-Object SizeGB -Descending | Select-Object -First ${top}
$files = @()
if (${includeFiles ? '$true' : '$false'}) {
  $files = Get-ChildItem -LiteralPath $target -Force -File | Sort-Object Length -Descending | Select-Object -First ${top} | ForEach-Object {
    [pscustomobject]@{
      Path = $_.FullName
      SizeGB = [math]::Round($_.Length / 1GB, 2)
      SizeMB = [math]::Round($_.Length / 1MB, 1)
      LastWriteTime = $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
    }
  }
}
[pscustomobject]@{
  Path = $target
  Exists = $true
  Children = $dirs
  Files = $files
} | ConvertTo-Json -Depth 7
`,
          { timeoutMs: 300000, maxBuffer: 20 * 1024 * 1024 },
        );
      });
    },
  );

  server.tool(
    'large_files',
    'Find large files under a Windows path. Output is bounded; file contents are never read.',
    {
      path: WindowsPathSchema.default('C:\\'),
      minMB: z.number().int().min(1).max(102400).optional().default(500),
      limit: z.number().int().min(1).max(200).optional().default(50),
    },
    async ({ path, minMB, limit }) => {
      return runJsonTool(async () => {
        return runPowerShellJson(
          String.raw`
$target = ${psString(path)}
$minBytes = [int64]${minMB} * 1MB
if (-not (Test-Path -LiteralPath $target)) {
  [pscustomobject]@{ Path = $target; Exists = $false } | ConvertTo-Json -Depth 4
  exit
}
$files = Get-ChildItem -LiteralPath $target -Force -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Length -ge $minBytes } |
  Sort-Object Length -Descending |
  Select-Object -First ${limit} |
  ForEach-Object {
    [pscustomobject]@{
      Path = $_.FullName
      SizeGB = [math]::Round($_.Length / 1GB, 2)
      SizeMB = [math]::Round($_.Length / 1MB, 1)
      LastWriteTime = $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
    }
  }
[pscustomobject]@{
  Path = $target
  Exists = $true
  MinMB = ${minMB}
  Limit = ${limit}
  Files = $files
} | ConvertTo-Json -Depth 6
`,
          { timeoutMs: 600000, maxBuffer: 20 * 1024 * 1024 },
        );
      });
    },
  );

  server.tool('photoshop_status', 'Report Photoshop process, scratch/temp files, memory preference, and Adobe cache sizes.', {}, async () => {
    return runJsonTool(async () => {
      return runPowerShellJson(String.raw`
function SizeOfPath($path) {
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  $sum = (Get-ChildItem -LiteralPath $path -Force -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
  [pscustomobject]@{ Path = $path; SizeGB = [math]::Round(($sum / 1GB), 2) }
}
$processes = Get-Process | Where-Object { $_.ProcessName -match 'Photoshop|Adobe|Creative|Lightroom|Bridge' } | Sort-Object ProcessName | ForEach-Object {
  [pscustomobject]@{
    ProcessName = $_.ProcessName
    Id = $_.Id
    MainWindowTitle = $_.MainWindowTitle
    StartTime = $(try { $_.StartTime.ToString('yyyy-MM-dd HH:mm:ss') } catch { $null })
    WorkingSetGB = [math]::Round($_.WorkingSet64 / 1GB, 2)
    PrivateMemoryGB = [math]::Round($_.PrivateMemorySize64 / 1GB, 2)
    CPUSeconds = $(if ($_.CPU) { [math]::Round($_.CPU, 1) } else { $null })
    Path = $_.Path
  }
}
$scratchFiles = Get-ChildItem -LiteralPath 'C:\Users\info\AppData\Local\Temp' -Force -File -Filter 'Photoshop Temp*' -ErrorAction SilentlyContinue | Sort-Object Length -Descending | ForEach-Object {
  [pscustomobject]@{
    Path = $_.FullName
    SizeGB = [math]::Round($_.Length / 1GB, 2)
    LastWriteTime = $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
    CreationTime = $_.CreationTime.ToString('yyyy-MM-dd HH:mm:ss')
  }
}
$pref = Get-ItemProperty -LiteralPath 'HKCU:\Software\Adobe\Photoshop\200.0' -ErrorAction SilentlyContinue
$settings = 'C:\Users\info\AppData\Roaming\Adobe\Adobe Photoshop 2026'
[pscustomobject]@{
  Processes = $processes
  ScratchFiles = $scratchFiles
  ScratchTotalGB = [math]::Round((($scratchFiles | Measure-Object SizeGB -Sum).Sum), 2)
  UserTemp = SizeOfPath 'C:\Users\info\AppData\Local\Temp'
  AutoRecover = SizeOfPath (Join-Path $settings 'AutoRecover')
  AdobeRoaming = SizeOfPath 'C:\Users\info\AppData\Roaming\Adobe'
  AdobeLocal = SizeOfPath 'C:\Users\info\AppData\Local\Adobe'
  ProgramDataAdobe = SizeOfPath 'C:\ProgramData\Adobe'
  MemoryUsagePercent = $(if ($pref -and $pref.MemoryUsage64 -ne $null) { [int]$pref.MemoryUsage64 } else { $null })
  ScratchWarningSeen = $(if ($pref -and $pref.ScratchWarningSeen -ne $null) { [int]$pref.ScratchWarningSeen } else { $null })
  TempEnv = $env:TEMP
} | ConvertTo-Json -Depth 7
`);
    });
  });

  server.tool(
    'process_list',
    'List Windows processes with bounded fields. Does not return command lines.',
    {
      pattern: z.string().max(100).optional().default('*'),
      sortBy: z.enum(['memory', 'cpu', 'name', 'pid']).optional().default('memory'),
      limit: z.number().int().min(1).max(200).optional().default(50),
    },
    async ({ pattern, sortBy, limit }) => {
      return runJsonTool(async () => {
        const sortExpression = processSortExpression(sortBy);
        return runPowerShellJson(String.raw`
$pattern = ${psString(pattern)}
$items = Get-Process |
  Where-Object { $_.ProcessName -like $pattern } |
  Sort-Object ${sortExpression} |
  Select-Object -First ${limit} |
  ForEach-Object {
    [pscustomobject]@{
      ProcessName = $_.ProcessName
      Id = $_.Id
      MainWindowTitle = $_.MainWindowTitle
      WorkingSetGB = [math]::Round($_.WorkingSet64 / 1GB, 2)
      PrivateMemoryGB = [math]::Round($_.PrivateMemorySize64 / 1GB, 2)
      CPUSeconds = $(if ($_.CPU) { [math]::Round($_.CPU, 1) } else { $null })
      StartTime = $(try { $_.StartTime.ToString('yyyy-MM-dd HH:mm:ss') } catch { $null })
      Path = $_.Path
    }
  }
[pscustomobject]@{ Pattern = $pattern; SortBy = ${psString(sortBy)}; Limit = ${limit}; Processes = $items } | ConvertTo-Json -Depth 6
`);
      });
    },
  );

  server.tool(
    'service_status',
    'List Windows service status by name/display-name wildcard.',
    {
      pattern: z.string().max(100).optional().default('*'),
      limit: z.number().int().min(1).max(200).optional().default(50),
    },
    async ({ pattern, limit }) => {
      return runJsonTool(async () => {
        return runPowerShellJson(String.raw`
$pattern = ${psString(pattern)}
$services = Get-Service |
  Where-Object { $_.Name -like $pattern -or $_.DisplayName -like $pattern } |
  Sort-Object Status, Name |
  Select-Object -First ${limit} |
  ForEach-Object {
    [pscustomobject]@{
      Name = $_.Name
      DisplayName = $_.DisplayName
      Status = $_.Status.ToString()
      StartType = $(try { $_.StartType.ToString() } catch { $null })
      CanStop = $_.CanStop
    }
  }
[pscustomobject]@{ Pattern = $pattern; Limit = ${limit}; Services = $services } | ConvertTo-Json -Depth 5
`);
      });
    },
  );

  server.tool(
    'event_log_recent',
    'Read recent Windows event log entries with truncated messages.',
    {
      logName: z.enum(['Application', 'System']).optional().default('System'),
      level: z.enum(['all', 'critical', 'error', 'warning', 'information']).optional().default('error'),
      hours: z.number().int().min(1).max(168).optional().default(24),
      providerPattern: z.string().max(120).optional().default('*'),
      limit: z.number().int().min(1).max(200).optional().default(50),
    },
    async ({ logName, level, hours, providerPattern, limit }) => {
      return runJsonTool(async () => {
        const levelClause = eventLevelClause(level);
        return runPowerShellJson(String.raw`
$filter = @{ LogName = ${psString(logName)}; StartTime = (Get-Date).AddHours(-${hours}) }
${levelClause}
$providerPattern = ${psString(providerPattern)}
$events = Get-WinEvent -FilterHashtable $filter -MaxEvents ${limit * 4} -ErrorAction SilentlyContinue |
  Where-Object { $_.ProviderName -like $providerPattern } |
  Select-Object -First ${limit} |
  ForEach-Object {
    $message = ($_.Message -replace '\r?\n', ' ')
    if ($message.Length -gt 800) { $message = $message.Substring(0, 800) + '...' }
    [pscustomobject]@{
      TimeCreated = $_.TimeCreated.ToString('yyyy-MM-dd HH:mm:ss')
      LogName = $_.LogName
      ProviderName = $_.ProviderName
      Id = $_.Id
      LevelDisplayName = $_.LevelDisplayName
      Message = $message
    }
  }
[pscustomobject]@{
  LogName = ${psString(logName)}
  Level = ${psString(level)}
  Hours = ${hours}
  ProviderPattern = $providerPattern
  Limit = ${limit}
  Events = $events
} | ConvertTo-Json -Depth 6
`);
      });
    },
  );

  server.tool(
    'cleanup_recycle_bin',
    `DANGEROUS: clear C: recycle bin. Requires confirm="${CLEAR_RECYCLE_BIN_CONFIRM}".`,
    {
      confirm: z.string().optional().default(''),
    },
    async ({ confirm }) => {
      if (confirm !== CLEAR_RECYCLE_BIN_CONFIRM) {
        return errorResponse(`Refusing to clear recycle bin. Pass confirm="${CLEAR_RECYCLE_BIN_CONFIRM}".`);
      }
      return runJsonTool(async () => {
        return runPowerShellJson(String.raw`
${DISK_STATE_FUNCTION}
$events = New-Object System.Collections.ArrayList
[void]$events.Add((DiskState 'before'))
Clear-RecycleBin -DriveLetter C -Force -ErrorAction Stop
[void]$events.Add((DiskState 'after'))
$sum = (Get-ChildItem -LiteralPath 'C:\$Recycle.Bin' -Force -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
[pscustomobject]@{
  Action = 'ClearRecycleBin'
  Events = $events
  RecycleBinSizeGB = [math]::Round(($sum / 1GB), 2)
} | ConvertTo-Json -Depth 5
`);
      });
    },
  );

  server.tool(
    'set_hibernation',
    `DANGEROUS: enable or disable Windows hibernation. Requires confirm="${SET_HIBERNATION_CONFIRM}".`,
    {
      enabled: z.boolean(),
      confirm: z.string().optional().default(''),
    },
    async ({ enabled, confirm }) => {
      if (confirm !== SET_HIBERNATION_CONFIRM) {
        return errorResponse(`Refusing to change hibernation. Pass confirm="${SET_HIBERNATION_CONFIRM}".`);
      }
      return runJsonTool(async () => {
        const mode = enabled ? 'on' : 'off';
        return runPowerShellJson(String.raw`
${DISK_STATE_FUNCTION}
$events = New-Object System.Collections.ArrayList
[void]$events.Add((DiskState 'before'))
$output = (& powercfg.exe /hibernate ${mode}) 2>&1 | Out-String
$exitCode = $LASTEXITCODE
[void]$events.Add((DiskState 'after'))
$hiber = Get-Item -LiteralPath 'C:\hiberfil.sys' -Force -ErrorAction SilentlyContinue
[pscustomobject]@{
  Action = 'SetHibernation'
  Enabled = ${enabled ? '$true' : '$false'}
  ExitCode = $exitCode
  Output = $output.Trim()
  Events = $events
  HiberfilExists = [bool]$hiber
  HiberfilSizeGB = $(if ($hiber) { [math]::Round($hiber.Length / 1GB, 2) } else { $null })
} | ConvertTo-Json -Depth 5
`);
      });
    },
  );

  server.tool(
    'windows_component_cleanup',
    `DANGEROUS: run DISM /StartComponentCleanup. Requires confirm="${START_COMPONENT_CLEANUP_CONFIRM}".`,
    {
      analyzeOnly: z.boolean().optional().default(false),
      confirm: z.string().optional().default(''),
    },
    async ({ analyzeOnly, confirm }) => {
      if (!analyzeOnly && confirm !== START_COMPONENT_CLEANUP_CONFIRM) {
        return errorResponse(`Refusing to run DISM cleanup. Pass confirm="${START_COMPONENT_CLEANUP_CONFIRM}", or set analyzeOnly=true.`);
      }
      return runJsonTool(async () => {
        const dismArgs = analyzeOnly
          ? '/Online /Cleanup-Image /AnalyzeComponentStore /English'
          : '/Online /Cleanup-Image /StartComponentCleanup /English';
        return runPowerShellJson(
          String.raw`
${DISK_STATE_FUNCTION}
$events = New-Object System.Collections.ArrayList
[void]$events.Add((DiskState 'before'))
$output = (& Dism.exe ${dismArgs}) 2>&1 | Out-String
$exitCode = $LASTEXITCODE
[void]$events.Add((DiskState 'after'))
[pscustomobject]@{
  Action = ${psString(analyzeOnly ? 'AnalyzeComponentStore' : 'StartComponentCleanup')}
  ExitCode = $exitCode
  Events = $events
  OutputTail = (($output -split '\r?\n') | Where-Object { $_ } | Select-Object -Last 60)
} | ConvertTo-Json -Depth 6
`,
          { timeoutMs: analyzeOnly ? 600000 : 1800000, maxBuffer: 20 * 1024 * 1024 },
        );
      });
    },
  );

  server.tool(
    'kill_process',
    `DANGEROUS: stop a Windows process by PID. Requires confirm="${KILL_PROCESS_CONFIRM}".`,
    {
      pid: z.number().int().min(1),
      confirm: z.string().optional().default(''),
    },
    async ({ pid, confirm }) => {
      if (confirm !== KILL_PROCESS_CONFIRM) {
        return errorResponse(`Refusing to stop process. Pass confirm="${KILL_PROCESS_CONFIRM}".`);
      }
      return runJsonTool(async () => {
        return runPowerShellJson(String.raw`
$before = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
if (-not $before) {
  [pscustomobject]@{ ProcessId = ${pid}; Found = $false; Stopped = $false } | ConvertTo-Json -Depth 4
  exit
}
$info = [pscustomobject]@{
  ProcessName = $before.ProcessName
  Id = $before.Id
  MainWindowTitle = $before.MainWindowTitle
  WorkingSetGB = [math]::Round($before.WorkingSet64 / 1GB, 2)
  PrivateMemoryGB = [math]::Round($before.PrivateMemorySize64 / 1GB, 2)
  Path = $before.Path
}
Stop-Process -Id ${pid} -Force -ErrorAction Stop
Start-Sleep -Milliseconds 500
$after = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
[pscustomobject]@{
  ProcessId = ${pid}
  Found = $true
  Stopped = (-not [bool]$after)
  Process = $info
} | ConvertTo-Json -Depth 5
`);
      });
    },
  );
}

async function runJsonTool(action: () => Promise<unknown>) {
  try {
    return jsonResponse(await action());
  } catch (error) {
    return errorResponse(toErrorMessage(error));
  }
}

function processSortExpression(sortBy: 'memory' | 'cpu' | 'name' | 'pid'): string {
  if (sortBy === 'cpu') return 'CPU -Descending';
  if (sortBy === 'name') return 'ProcessName';
  if (sortBy === 'pid') return 'Id';
  return 'PrivateMemorySize64 -Descending';
}

function eventLevelClause(level: 'all' | 'critical' | 'error' | 'warning' | 'information'): string {
  const levels: Record<typeof level, number | null> = {
    all: null,
    critical: 1,
    error: 2,
    warning: 3,
    information: 4,
  };
  const value = levels[level];
  return value === null ? '' : `$filter.Level = ${value}`;
}
