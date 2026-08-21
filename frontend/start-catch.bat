@echo off
REM Doppio clic su questo file per avviare il server di sviluppo di Catch.
REM Lascia la finestra aperta mentre lavori; chiudila per fermare il server.
cd /d "%~dp0"
echo Avvio Catch su http://localhost:5173 ...
start "" http://localhost:5173
npm run dev
