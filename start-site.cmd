@echo off
cd /d %~dp0
set PYTHONPATH=c:\sources\qlstats\xonstat\lib\python
paster serve local.ini
