# Guion de Presentación en Vivo — Nodaly

Este guion está pensado para demostrar **Nodaly** funcionando de principio a fin durante la exposición del proyecto FEPI, cubriendo tanto el caso general (Menú PDF + Inventario Excel) como los **4 flujos guardados** basados en las entrevistas reales del documento `Proyecto_FEPI (1).pdf`.

---

## 1. Preparación antes de empezar (en 2 minutos)

### Opción recomendada: Vercel conectado a tu backend local (con OpenRouter)
1. En una terminal, levanta el backend en el puerto `8001` (para evitar conflictos con Docker en el `8000`):
   ```powershell
   $env:OPENROUTER_API_KEY="sk-or-v1-tu-clave"
   .\backend\.venv\Scripts\uvicorn.exe app:app --app-dir backend --host 127.0.0.1 --port 8001
   ```
2. En otra terminal, abre el túnel HTTPS:
   ```powershell
   cloudflared tunnel --url http://127.0.0.1:8001
   ```
3. Copia la URL `https://xxxx.trycloudflare.com` y configúrala en **Vercel → Settings → Environment Variables** como `VITE_BACKEND_URL` (haz Redeploy), o pégala en el botón **Conectar ngrok** arriba a la derecha.
4. Verifica que en la barra superior aparezca el indicador verde **Backend local + IA** (o **En navegador (Vercel)** si lo muestras sin backend).

---

## 2. Guion de demostración en vivo (qué mostrar y qué preguntar)

### Flujo 0 (Inicio): Asistente de Menú (PDF) e Inventario (Excel)
> **Qué explicar:** *"Nodaly permite conectar fuentes reales como un menú en PDF y un inventario en Excel directamente a un agente de IA, y probarlo en un chat simulado tipo WhatsApp."*

1. En **Plantillas**, asegúrate de tener cargado **Asistente de Menú e Inventario**.
2. Haz clic en el nodo **Base de conocimiento** para mostrar en el panel derecho que tiene conectados `Menu_Restaurante.pdf` e `Inventario_Cocina.xlsx`.
3. Haz clic en el ícono del **ojo** junto a `Inventario_Cocina.xlsx` para mostrar la tabla extraída en vivo.
4. En el panel **Simulador de chat (WhatsApp)**, prueba estos mensajes (o usa los chips rápidos):
   - `"¿Qué tacos tienen y cuánto cuestan?"` → Responde con los platillos y precios del PDF.
   - `"¿Hay refresco en inventario?"` → Cruza con el Excel e indica que `Refresco 355ml` tiene stock `0` (**Agotado**).

---

### Flujo 1 (Guardados): Cotizador Mesas de Dulces — *Entrevista 1 (Sandra Díaz)*
> **Problemática que resuelve:** Sandra perdía tiempo armando cotizaciones por Instagram/WhatsApp y cometía errores cuando cambiaban los precios.

1. En la barra superior, abre **Guardados** → selecciona **`1. Cotizador Mesas de Dulces (Sandra)`**.
2. Selecciona el nodo **Catálogo Sandra (Excel)** para mostrar `Catalogo_Mesas_Sandra.xlsx` (o la lista de precios).
3. En el **Chat WhatsApp**, envía:
   - `"¿Cuánto cuesta la mesa premium?"`
   - `"Cotiza 1 mesa clásica + exhibidores + envío"` → El bot suma los conceptos del catálogo (`$1,800 + $450 + $250 = $2,500 MXN`).

---

### Flujo 2 (Guardados): Control de Obra y Gastos — *Entrevista 2 (Julio Zuñiga)*
> **Problemática que resuelve:** Julio necesitaba registrar gastos de materiales, obra y transporte sin errores manuales ni hojas sueltas.

1. En **Guardados**, selecciona **`2. Control de Obra y Gastos (Julio)`**.
2. En el **Chat WhatsApp**, envía un gasto natural:
   - `"Hoy gasté 850 en soldadura"`
3. **Qué ocurre:** El flujo extrae automáticamente `Concepto`, `Categoría (Insumos)` e `Importe (850.00)` y muestra una tarjeta de **Confirmación** dentro de la burbuja de WhatsApp (control humano antes de guardar).
4. Haz clic en **Confirmar registro**.
5. Cambia a la pestaña **Registros** para demostrar que el gasto quedó guardado.

---

### Flujo 3 (Guardados): Cortes y Reportes EvoGym — *Entrevista 3 (Gimnasio EvoGym)*
> **Problemática que resuelve:** El 70% de la carga operativa del gimnasio se iba en cortes de caja y reportes administrativos.

1. En **Guardados**, selecciona **`3. Cortes y Reportes EvoGym (Gimnasio)`**.
2. En el **Chat WhatsApp**, envía:
   - `"Muestra todos los gastos"` → Incluye el gasto de `$850.00` que acabas de registrar en el Flujo 2 más los registros base.
   - `"Gastos de hoy en insumos"` → Filtra únicamente la categoría de insumos y recalcula el total exacto.

---

### Flujo 4 (Guardados): Soporte y Cursos en Línea — *Entrevista 4 (Fernando Suárez)*
> **Problemática que resuelve:** Retrasos en atención por WhatsApp y falta de clasificación automática entre dudas simples e incidencias técnicas.

1. En **Guardados**, selecciona **`4. Soporte y Cursos en Línea (Fernando)`**.
2. En el **Chat WhatsApp**, envía:
   - `"¿Cómo descargo mi constancia?"` → Responde con los pasos de la guía (`Guia_Soporte_Cursos.pdf`).
   - `"Tengo un problema de pago empresarial"` → Clasifica como incidencia de Soporte Técnico y pide correo/matrícula para escalar.

---

### Cierre: Personalización en vivo (10 segundos)
- Arrastra cualquier nodo o cambia el **Modelo de OpenRouter** en el nodo **Agente de IA**, haz clic en **Guardar**, y muestra cómo se conserva en **Guardados**.
- Para ver las diapositivas académicas, haz clic en **Presentación** en la barra superior (incluye controles `-` / `+` / `Ajustar` para cualquier tamaño de pantalla) o abre [Presentacion_Nodaly_FEPI.pdf](file:///c:/Users/edani/OneDrive/Documents/Proyectos/Nodaly/Presentacion_Nodaly_FEPI.pdf).
