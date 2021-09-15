@echo off
cd /d %~dp0
set PYTHONPATH=d:\sources\qlstats\xonstat\lib\python
paster serve local.ini
