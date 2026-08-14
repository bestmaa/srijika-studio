@echo off
setlocal

set "PLUGIN_ROOT=%~dp0.."
set "ENTRY_POINT=%PLUGIN_ROOT%\scripts\run-mcp.mjs"

if not exist "%ENTRY_POINT%" (
  >&2 echo Srijika Studio MCP bundle is missing. Rebuild the plugin package.
  exit /b 1
)

if defined SRIJIKA_STUDIO_MCP_NODE (
  "%SRIJIKA_STUDIO_MCP_NODE%" "%ENTRY_POINT%"
  exit /b %errorlevel%
)

where node.exe >nul 2>&1
if not errorlevel 1 (
  node.exe "%ENTRY_POINT%"
  exit /b %errorlevel%
)

set "CODEX_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%CODEX_NODE%" (
  "%CODEX_NODE%" "%ENTRY_POINT%"
  exit /b %errorlevel%
)

>&2 echo Node.js 22 or the Codex bundled Node runtime is required to start Srijika Studio MCP.
exit /b 1
