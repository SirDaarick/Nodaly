# Guion para presentar Nodaly en clase

Pulsa **Presentación** en la barra superior para ver las diapositivas. Cierra el visor para volver al mismo flujo.

## 1. Asistente documental

Abre la plantilla del asistente documental y selecciona el nodo Base de conocimiento. Adjunta `samples/informacion-gimnasio.txt` y marca su casilla. Si quieres usar solo el archivo, borra el texto de ejemplo.

Prueba estas preguntas:
- ¿Cuál es el horario de apertura?
- ¿Cuánto cuesta la membresía mensual?
- ¿De qué color son los casilleros? (no está documentado: debe indicar que no encuentra la información)

El modo local busca coincidencias de texto; no es un modelo de lenguaje y puede no reconocer algunas formas de preguntar. El proveedor de IA opcional se configura expresamente en el servidor.

## 2. Registro de gastos

Abre Registro de gastos. Escribe `Hoy gasté 350 pesos en productos de limpieza`. Ejecuta el flujo, revisa los datos y confirma. Abre Registros para comprobar que se guardó. Usa solo información ficticia.

## 3. Reporte de gastos

Abre Reporte de gastos. Escribe `Muéstrame los gastos de hoy`. Ejecuta el flujo y revisa el total y las categorías. El gasto anterior debe aparecer. Repite la consulta seleccionando una categoría para demostrar los filtros.

## 4. Editar el flujo

Selecciona un nodo, cambia su nombre y muévelo en el lienzo. Guarda el flujo y vuelve a abrirlo desde Flujos guardados. Desconecta una acción y ejecuta para mostrar la validación; después carga una plantilla para recuperar un flujo válido.

## Distribución del tiempo

Dedica aproximadamente dos minutos al problema y los nodos, tres al asistente documental, tres al registro y reporte de gastos y dos a la edición y las conclusiones. Inicia la aplicación y ensaya antes de clase; no instales dependencias durante la presentación.
