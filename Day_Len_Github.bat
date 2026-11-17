@echo off
chcp 65001 > nul
echo ========================================================
echo   DANG CAP NHAT VA DAY CODE LEN GITHUB (Leloicode)...
echo ========================================================
git add .
git commit -m "update: Auto sync web admin dashboard"
git push origin main
echo.
echo ========================================================
echo   DA DAY CODE LEN GITHUB THANH CONG!
echo   Vercel se tu dong deploy ban moi trong 10-20 giay.
echo ========================================================
pause
