takeown /f C:\code\deepseek\dsh-mobile\node_modules /r /d y
icacls C:\code\deepseek\dsh-mobile\node_modules /grant administrators:F /t /q
icacls C:\code\deepseek\dsh-mobile\node_modules /grant Everyone:F /t /q
rd /s /q C:\code\deepseek\dsh-mobile\node_modules
