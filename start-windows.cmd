@echo off
setlocal
pushd "%~dp0"
if errorlevel 1 goto directory_error

py -3 -c "import sys; sys.exit(sys.version_info < (3, 9))" >nul 2>&1
if errorlevel 1 goto use_python
py -3 -X utf8 server.py %*
goto done

:use_python
python -c "import sys; sys.exit(sys.version_info < (3, 9))" >nul 2>&1
if errorlevel 1 goto python_error
python -X utf8 server.py %*

:done
set "status=%errorlevel%"
popd
if not "%status%"=="0" pause
exit /b %status%

:python_error
popd
echo Python 3.9 or newer is required. Install Python and run this file again. >&2
pause
exit /b 1

:directory_error
echo Unable to open the Writing Studio project directory. >&2
pause
exit /b 1
