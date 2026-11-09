# Backend de Nodaly

Prototipo local para demostraciones en clase. Usa Python 3.10 o posterior:

```powershell
cd backend
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m uvicorn app:app --host 127.0.0.1 --port 8000
```

Los datos se conservan en `nodaly.sqlite3` junto a `app.py`. Define `NODALY_DB` para usar otra ruta. El servidor está diseñado para uso local, no para publicarse en internet. Los gastos de ejemplo son ficticios y se crean una sola vez.

Sin configuración, la demostración usa coincidencias extractivas y palabras clave locales, no un modelo de lenguaje. Puede omitir respuestas, conceptos o categorías; revisa la vista previa antes de confirmar. Los PDF deben contener texto seleccionable, no imágenes escaneadas. Cada archivo admite hasta 5 MB y el contexto de conocimiento hasta 24.000 caracteres.

Opcionalmente, las respuestas sobre documentos pueden usar un proveedor compatible con el endpoint de chat completions de OpenAI. Define `NODALY_AI_URL` (URL HTTPS completa del endpoint), `NODALY_AI_MODEL` y `NODALY_AI_KEY` en el entorno del backend antes de iniciarlo. El contexto del documento y el mensaje se envían al proveedor. La extracción y el filtrado de gastos siguen reglas locales deterministas. No se leen credenciales automáticamente y la demostración sin conexión no requiere proveedor.

Ejecuta las pruebas desde este directorio con `.venv\Scripts\python -m unittest discover -s . -v`. Usan una base de datos temporal aislada y no llaman a ningún proveedor de IA.
