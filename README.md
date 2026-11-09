# Prototipo de Nodaly

Editor visual de flujos para una demostración de diez minutos en clase. El HTML original y el PDF del proyecto se conservan sin cambios.

## Demostración web en Vercel

Importa el repositorio con la raíz del proyecto en el directorio principal. El archivo `vercel.json` publica el editor y la presentación como un sitio Vite estático, sin servidor, base de datos ni variables de entorno.

Las tres plantillas muestran resultados de ejemplo, no ejecutan IA ni procesan archivos. Puedes editar el flujo y simular un registro; al recargar se pierde todo cambio. La aplicación local descrita abajo conserva su funcionamiento original.

Para probar esta versión sin FastAPI: `npm --prefix frontend run dev -- --mode showcase`.

## Iniciar la aplicación

Requisitos: Node.js 20 o superior y Python 3.11 o superior. Abre dos terminales de PowerShell desde esta carpeta.

### Servidor

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/python -m pip install -r backend/requirements.txt
backend/.venv/Scripts/python -m uvicorn app:app --app-dir backend --host 127.0.0.1 --port 8000
```

### Interfaz

```powershell
cd frontend
npm install
npm run dev -- --host 127.0.0.1
```

Abre la dirección local que indique Vite y mantén ambas terminales abiertas. No publiques esta aplicación: no tiene inicio de sesión ni aislamiento entre usuarios.

## Demostración

1. Abre la plantilla del asistente documental. Añade información del negocio como texto o adjunta un PDF con texto o TXT. Haz una pregunta y revisa la fuente. Prueba también una pregunta que no esté respondida en el contenido.
2. Abre el registro de gastos. Escribe un gasto, revisa los datos extraídos y confirma. Debe guardarse un solo registro.
3. Abre el reporte de gastos. Consulta un periodo y revisa los totales y las categorías. El nuevo gasto debe aparecer si coincide con los filtros.
4. Mueve o configura un nodo, guarda el flujo y vuelve a abrirlo para mostrar que las plantillas son editables.

Los siete nodos son Recibir mensaje, Base de conocimiento, Agente IA, Responder, Registrar información, Consultar registros y Generar reporte. La base de conocimiento aporta contexto; las demás conexiones determinan la ejecución. Los cálculos se hacen con código, no con IA.

## Modo de demostración y privacidad

El modo local usa reglas y recuperación de texto: no es un modelo de lenguaje y tiene comprensión limitada. No necesita claves de API. Consulta `backend/README.md` para configurar deliberadamente un proveedor de IA opcional. El contenido enviado al proveedor sale del equipo y puede generar cargos. Usa únicamente datos ficticios.

## Alcance

Almacenamiento local, documentos cortos TXT/PDF con texto, una cadena de ejecución y tres plantillas. Sin OCR, mensajería externa, código o SQL arbitrario, herramientas autónomas, despliegue público ni garantías contables.

## Comprobaciones

Las instrucciones de pruebas están en los archivos README de `frontend` y `backend`. El seguimiento de implementación y sus resultados están en `odd/tasks/classroom-prototype.md`.

## Material para clase

Consulta [el guion de la demostración](samples/DEMO.md) y [la información ficticia del gimnasio](samples/informacion-gimnasio.txt).
