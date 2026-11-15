# Decisiones de diseño: mensajería y procesamiento

Alcance: `camera-queue` (RabbitMQ), `edge-processor` y `cv-module`.

Cada decisión registra:
- qué se decidió y por qué;
- de qué clase sale, o **[FUERA DE CLASE]**;
- el **trade-off aceptado**: qué se pierde o qué costo se asume;
- **cómo afecta** al resto del sistema y al equipo;
- la alternativa que se descartó.

---

## D1. El clip va a MinIO y por la cola viaja solo la metadata (*claim check*)
- **Por qué:** un clip pesa mucho más que su metadata. Si el broker cargara los clips, se volvería un cuello de botella de memoria y disco. La cola transporta referencias livianas y MinIO, que está hecho para eso, guarda los objetos.
- **Fuente:** Tema 4.1 p.13 (el mensaje como contenedor de datos con metadatos). El nombre *claim check* es **[FUERA DE CLASE]**.
- **Trade-off aceptado:** procesar un clip depende de **dos** servicios (RabbitMQ y MinIO), no de uno. Si MinIO no está disponible, el mensaje llega pero el worker no puede bajar el clip. Además, el mensaje y el objeto pueden desincronizarse: un mensaje puede apuntar a un objeto borrado por la retención, o puede quedar un objeto huérfano si la publicación falla después de subirlo.
- **Cómo afecta:** el edge sube el clip **antes** de publicar. Si MinIO falla, no publica. El worker trata "objeto inexistente" como fallo, y el mensaje va a la DLQ. La retención de MinIO tiene que ser mayor que el tiempo máximo que un mensaje puede esperar en la cola.
- **Alternativa descartada:** mandar el clip codificado en base64 dentro del mensaje. Es más simple, pero satura el broker y anula la ventaja de un edge liviano.

## D2. Contrato fijo de 8 campos, sin campo de versión
- **Por qué:** los campos están fijados en "Decisiones finales" y otros integrantes dependen de esos nombres.
- **Fuente:** Decisiones finales, punto 5. Tema 4.1 p.7–8 pide acordar esquema y codificación.
- **Trade-off aceptado:** sin `schema_version`, un cambio incompatible del contrato obliga a actualizar edge y worker a la vez, y los mensajes viejos que queden en la cola pueden fallar.
- **Cómo afecta:** cambiar el contrato es una decisión de equipo y se documenta en el README, sección 2.1. Agregar campos opcionales sí es seguro: el worker ignora los que no conoce.
- **Alternativa descartada:** versionar el esquema. Es la práctica para sistemas de larga vida, y está de más para el alcance del proyecto.

## D3. `clip_id` (UUID) como clave de idempotencia; `trace_id` = `clip_id`
- **Por qué:** con ACK manual la entrega es *at-least-once*, así que el mismo mensaje puede procesarse dos veces (por ejemplo, si un worker muere antes del ACK). Un identificador único por clip permite descartar el duplicado en la base de datos.
- **Fuente:** Tema 4.4 p.8 (*at-least-once*: "puede entregarse más de una vez"). La consistencia ante concurrencia se trata en el Tema 6, en el punto 6.
- **Trade-off aceptado:** no buscamos *exactly-once*, que es caro (Tema 4.4 p.8). Puede haber **trabajo repetido**, pero **nunca resultados duplicados**. Usar el mismo valor como `trace_id` obliga a tener un clip por traza; no se puede seguir algo más grande que un clip.
- **Cómo afecta:** `results.clip_id` es `UNIQUE` y el insert usa `ON CONFLICT DO NOTHING`. Ro y Jaeger (si se llega a usar) siguen un clip por `trace_id`.
- **Alternativa descartada:** deduplicar en memoria del worker. No funciona con varias réplicas: Tema 2.0 p.12, procesos *share-nothing*.

## D4. IDs de cámara e intersección de texto (`cam-N`, `int-N`)
- **Por qué:** se leen directamente en logs, en la DLQ y en el panel de RabbitMQ, y coinciden con `CAMERA_IDS=cam-1:int-1,...`.
- **Fuente:** decisión propia.
- **Trade-off aceptado:** las PK de texto ocupan algo más que los enteros y no son autoincrementales: el ID se asigna a mano al dar de alta una cámara.
- **Cómo afecta:** Joaco G usa PK de texto en `cameras` e `intersections`. El alta de cámaras de la API tiene que recibir el ID.
- **Alternativa descartada:** IDs enteros `SERIAL`. Obligaría a mantener a mano la correspondencia entre `CAMERA_IDS` y la base.

## D5. `cv-module` sin `container_name` ni puerto publicado en el host
- **Por qué:** Docker exige nombres de contenedor únicos, y un puerto del host solo puede usarlo un contenedor. Con cualquiera de los dos, `--scale` falla. Sin ellos, el servicio escala con `docker compose up --scale cv-module=N`.
- **Fuente:** Tema 2.0 p.14 (VIII, escalar agregando procesos) y p.12 (VI, procesos sin estado). Tema 1.2 p.21 (replicación para balancear la carga) y p.7 (transparencia de replicación).
- **Trade-off aceptado:** el `/health` de cada réplica deja de verse desde `localhost:8002`; hay que entrar con `docker compose exec --index N`. Desde la red interna, `cv-module:8002` reparte por DNS entre réplicas, así que no se puede elegir una réplica en particular por HTTP.
- **Cómo afecta:** ningún servicio usaba el puerto 8002 del host. Si se llega a usar Prometheus (Fase 2), tiene que descubrir las réplicas por DNS (`dns_sd_configs`), no por un puerto fijo. `CV_MODULE_PORT` se quitó de `.env.example`.
- **Alternativa descartada:** declarar `cv-module-1`, `cv-module-2` y `cv-module-3` a mano en el compose. Es fijo, repetitivo y no escala con un número.

## D6. DLQ con *dead-letter exchange* nativo, no publicando a mano desde el worker
- **Por qué:** cuando un mensaje falla, el worker hace un solo `basic_nack(requeue=False)` y RabbitMQ lo mueve a la DLQ de forma **atómica**. Si el worker publicara la copia y después hiciera ACK, una caída entre las dos operaciones duplicaría el mensaje o lo perdería. El DLX además recibe los mensajes vencidos por TTL o rechazados por largo de cola, y agrega el header `x-death` con el motivo, la cola de origen y el conteo.
- **Fuente:** Tema 4.4 p.9 (concepto de DLQ). El mecanismo `x-dead-letter-exchange` es **[FUERA DE CLASE]**.
- **Trade-off aceptado:** la DLQ depende de una configuración del broker (`definitions.json`), no de código visible en el worker. Cambiar los argumentos de una cola que ya existe obliga a **recrearla**, porque RabbitMQ no permite modificarlos, y eso pierde los mensajes que tuviera.
- **Cómo afecta:** el edge y el worker **no declaran** la cola con argumentos propios. Usan `queue_declare(passive=True)`, que solo verifica que exista; si no, RabbitMQ responde `PRECONDITION_FAILED`. Ro puede contar los mensajes de `camera_dlq` como métrica. Los reintentos con contador (extra 2) se suman encima: se republica con un header, y al superar N intentos se hace `nack`, que manda el mensaje al DLX.
- **Alternativa descartada:** que el worker publique en `camera_dlq`. No es atómico, cubre solo los fallos que detecta el worker y repite lógica en cada consumidor.

## D7. `dlx` de tipo fanout, sin `x-dead-letter-routing-key`
- **Por qué:** el mensaje rechazado conserva su routing key original (`camera_processing_queue`). Un fanout lo entrega a `camera_dlq` sin importar la key, así que no hace falta configurar nada más.
- **Fuente:** Tema 4.4 p.7 (exchange fanout).
- **Trade-off aceptado:** todo lo que llegue a `dlx` va a la misma DLQ. Si mañana otra cola usara `dlx`, sus mensajes se mezclarían con los de cámaras; para separarlos habría que pasar a un exchange direct con una routing key por cola.
- **Cómo afecta:** hoy solo `camera_processing_queue` usa `dlx`, así que no hay mezcla. Los mensajes de la DLQ se distinguen por `x-death.queue`.
- **Alternativa descartada:** un exchange direct con `x-dead-letter-routing-key: camera_dlq`. Funciona igual, con un parámetro más.

## D8. Topología de colas en `definitions.json`, no declarada por código
- **Por qué:** la topología (colas, exchanges, DLQ) queda en un solo lugar de infraestructura y existe antes de que arranque cualquier servicio. Así se evita que dos servicios la declaren con argumentos distintos.
- **Fuente:** es lo que ya usaba el repo. La clase no lo trata (Tema 4.4 no dice cómo se declaran las colas).
- **Trade-off aceptado:** la configuración del broker queda separada del código que la usa, y hay que mirar dos lugares para entender el flujo. Si se cambia `definitions.json` con el contenedor corriendo, no se aplica hasta recrearlo.
- **Cómo afecta:** cualquier cola nueva de este broker se agrega en `infrastructure/camera-queue/definitions.json`.
- **Alternativa descartada:** que cada servicio haga `queue_declare` con todos los argumentos. Es frágil cuando varios servicios declaran la misma cola.

## D9. El broker usa un volumen anónimo y la topología se recrea desde `definitions.json`
- **Por qué:** el compose no le da a `camera-queue` un volumen con nombre, así que `/var/lib/rabbitmq` es un volumen anónimo. Para aplicar argumentos nuevos de cola (D6), se borra ese volumen y RabbitMQ arranca limpio con `definitions.json`.
- **Fuente:** Tema 4.4 p.8 (persistencia `durable`). El manejo de volúmenes de Docker es **[FUERA DE CLASE]**.
- **Trade-off aceptado:** recrear el broker **borra los mensajes encolados**. Es aceptable en desarrollo y en las demos, no en producción. Además, al recrearlo apareció una vez un fallo transitorio de arranque: `.erlang.cookie: eacces`, por la cookie con dueño `root`. Se resolvió repitiendo el comando.
- **Cómo afecta:** cualquier cambio en `definitions.json` exige `docker compose rm -sfv camera-queue && docker compose up -d camera-queue` (está en el README). Los mensajes `durable` sí sobreviven a un reinicio normal (`docker compose restart camera-queue`), porque el volumen se conserva.
- **Alternativa descartada:** cambiar los argumentos en caliente con una *policy* (`rabbitmqctl set_policy ... dead-letter-exchange`). No obliga a recrear nada, pero deja la configuración fuera de `definitions.json`, salvo que la policy también se agregue ahí.

## D10. El edge escala por zonas: una instancia por grupo de cámaras, repartidas por configuración
- **Por qué:** el sistema está pensado para una ciudad, con cientos de cámaras. En la realidad hay un edge por zona, cerca de sus cámaras. El edge no guarda estado, así que sumar zonas es sumar instancias con otro `CAMERA_IDS` (o `CAMERA_RANGE`), sin tocar código. Dentro de cada instancia, un pool de `EDGE_THREADS` hilos reparte las cámaras. Cada hilo tiene su propia conexión pika, porque la conexión no se puede compartir entre hilos.
- **Fuente:** Tema 1.2 p.19 (escalabilidad geográfica y de tamaño). Tema 2.0 p.7 (III, configuración por entorno) y p.14 (VIII, concurrencia por procesos). EDA-AWS p.2 (servicios que escalan y fallan de forma independiente).
- **Estimación de capacidad** (sin medir todavía; la prueba de carga va al punto 8): con 500 cámaras y un clip cada 5 s hay 100 clips/s. RabbitMQ (~300 bytes por mensaje) y PostgreSQL (100 inserts/s) sobran. Los workers escalan con `--scale`. MinIO recibe ~19 MB/s, unos 1,6 TB por día, así que la **retención** pasa a ser necesaria.
- **Trade-off aceptado:**
  - **Reparto estático:** sumar cámaras a una zona obliga a reiniciar su edge. Se pierden 1 o 2 clips por cámara de esa zona (unos 5 a 10 s), algo irrelevante para una congestión que se mide por minutos.
  - **Si un edge se cae, sus cámaras quedan sin datos** hasta que vuelva. Nadie toma esas cámaras, y lo que no se capturó no se recupera, porque no hay buffer local. El impacto es **local**: las otras zonas, los workers y el dashboard siguen andando.
  - El pool de hilos suma complejidad: una conexión por hilo.
- **Cómo afecta:**
  - Si una ronda tarda más que `FRAME_INTERVAL`, el edge loguea `edge_lagging`: es la señal de que esa zona necesita otra instancia.
  - **Hernán:** "sin datos" no es "sin congestión". El dashboard tiene que mostrar la hora del último dato y marcar las intersecciones sin clips recientes.
  - **Ro:** que una cámara deje de publicar `clip_published` durante N minutos es una alerta.
- **Alternativa descartada:** asignar cámaras de forma dinámica con un coordinador (ZooKeeper, con líder y nodos efímeros, Tema 6 p.32–42). Las cámaras de un edge caído pasarían a otro, pero es mucho más complejo: queda como **trabajo futuro**.

## D11. `restart: unless-stopped` en `edge-processor` y `cv-module`
- **Por qué:** si el proceso se cae (una excepción no manejada, falta de memoria), Docker lo vuelve a levantar en segundos sin intervención.
- **Fuente:** Tema 2.0 p.15 (IX, desechabilidad: los procesos se inician y se detienen en cualquier momento).
- **Trade-off aceptado:** un error que se repite al arrancar entra en un ciclo de reinicios; se nota en `docker compose ps` y en los logs. No cubre que se caiga la máquina.
- **Cómo afecta:** en la demo, `docker kill` de un worker cuenta como parada manual, así que Docker no lo relanza y se ve claramente cómo otro worker toma el mensaje.
- **Alternativa descartada:** healthchecks con reinicio por orquestador (Kubernetes): está fuera del alcance aprobado.

## D12. ACK después del COMMIT, `processed_at` con el reloj de la base y fallos directo a la DLQ
- **Por qué:**
  - Si el worker muere después de guardar y antes del ACK, RabbitMQ reentrega el mensaje y `ON CONFLICT DO NOTHING` (D3) evita el duplicado.
  - Si hiciera el ACK antes de guardar, una caída perdería el resultado.
  - `processed_at` usa `now()` de PostgreSQL, así todas las réplicas comparten un único reloj.
- **Fuente:** Tema 4.4 p.8 (ACK manual, *at-least-once*). Tema 2.0 p.15 (un worker debe devolver el trabajo a la cola). Tema 6 p.4–5 y p.17 (los relojes físicos de cada nodo no coinciden). EDA-AWS p.8 (consumidores idempotentes). La base como árbitro único de la escritura es análoga al servidor central de exclusión mutua (Tema 6 p.24). `ON CONFLICT` es **[FUERA DE CLASE]**.
- **Trade-off aceptado:**
  - Un duplicado repite el trabajo de CV, aunque no se guarde dos veces.
  - `ts` (la captura) usa el reloj del edge, que puede no coincidir con el de la base.
  - **Todo fallo va directo a la DLQ, sin reintentos:** una caída temporal de la base manda clips buenos a `camera_dlq`, y hay que reprocesarlos a mano. El extra 2 (reintentos con contador) lo resuelve.
- **Cómo afecta:** Hernán ordena el histórico por `ts` (captura). Mirar `camera_dlq` sirve para detectar problemas de infraestructura.
- **Alternativa descartada:** `requeue=True` ante cualquier error. Un mensaje que no se puede procesar (por ejemplo, un JSON roto) quedaría dando vueltas para siempre.

## D14. Sin buffer local en el edge (*store-and-forward* queda como trabajo futuro)
- **Por qué:** era una simplificación aprobada. En la demo, el edge y el broker comparten la red de Docker, así que la falla que cubre un buffer (corte del enlace entre la esquina y el centro) no ocurre. Además, el dato de congestión envejece rápido: lo que más importa es el ahora.
- **Fuente:** decisión del equipo (simplificaciones aprobadas). El patrón *store-and-forward* es **[FUERA DE CLASE]**.
- **Trade-off aceptado:** **durante una caída de RabbitMQ o de MinIO se pierden los clips de esa zona.** RabbitMQ caído: 4 reintentos (unos 15 s) y el clip se descarta; mientras tanto, ese hilo atrasa a sus otras cámaras (`edge_lagging`). MinIO caído: el clip se pierde enseguida. El histórico queda con huecos.
- **Cómo afecta:** los huecos se ven como "sin datos" en el dashboard (ver D10). En el informe se presenta como trabajo futuro.
- **Por qué el diseño ya lo soporta:** reenviar clips viejos no duplica nada, porque `clip_id` hace idempotente el guardado (D3), y un clip que llega tarde queda en su lugar del histórico porque `ts` es el momento de captura (D12). Agregarlo sería un directorio de pendientes en un volumen y un hilo que lo vacía al recuperarse la conexión.
- **Alternativa descartada (por ahora):** implementarlo. Exige manejar el disco del edge (cuota y qué descartar si se llena) y absorber la ráfaga de clips viejos al recuperarse. Por tiempo se priorizaron los logs (punto 7) y las demos (punto 8).

## D15. Logs a stdout y a `logs_queue`, con envío asíncrono y cola en memoria acotada
- **Por qué:** stdout es el flujo de eventos del proceso (12-Factor XI), y `logs_queue` alimenta el `monitoring-pipeline` de Ro, que calcula las métricas. Si se publicara en el mismo hilo que procesa clips, una caída de `logs-queue` frenaría el producto. Por eso `log_event` solo imprime y deja el registro en una cola en memoria; un hilo aparte (`log-shipper`) la vacía publicando en RabbitMQ. **La observabilidad no puede tirar abajo el producto.**
- **Fuente:** Tema 7 p.3 y p.8–10 (pilar logs, JSON). Tema 2.0 p.18 (XI, logs como flujo de eventos a stdout). Tema 4.4 (cola). EDA-AWS p.9 (seguir un evento entre servicios, por eso viaja `trace_id`). El envío asíncrono con cola acotada es **[FUERA DE CLASE]**.
- **Probado** (evidencias 06 y 07): stdout y la cola coinciden exactamente (81 = 81). Con `logs-queue` caído 30 s, los clips se siguieron guardando sin errores, y al volver el shipper reconectó solo sin perder ningún log (329 = 329).
- **Trade-off aceptado:**
  - Los logs llegan a la cola con milisegundos de atraso.
  - Si la caída es larga y se llenan los 10 000 registros en memoria, **se descartan los nuevos** (se avisa con `logs_dropped`): las métricas de Ro quedan bajas en ese período, aunque stdout los conserva.
  - Los logs no usan publisher confirms (envío con el mejor esfuerzo, a diferencia de los clips).
  - Si el proceso muere, se pierde lo que estaba en memoria sin enviar; al apagar con orden, `flush()` espera hasta 3 s.
  - `logs.py` queda duplicado en edge y worker, porque cada servicio es una imagen aparte.
- **Cómo afecta:**
  - **Ro** consume `logs_queue` con el formato del punto 6 más campos extra.
  - Mientras no haya consumidor, `logs_queue` crece sin límite (en la prueba: ~330 mensajes en 2 minutos). Se sugiere `x-max-length` o un TTL en `infrastructure/logs-queue/definitions.json`, que es de Ro.
  - Los avisos internos del shipper (`log_shipper_retry`) salen solo por stdout.
- **Alternativa descartada:** publicar en el mismo hilo, que es más simple pero acopla el procesamiento a la disponibilidad de `logs-queue`. También se descartó un agente externo que lea stdout (Fluent Bit/Filebeat): no hay que tocar el código, pero suma otro contenedor y su configuración.

## D16. CV simulado: qué valida, qué no, y el camino a CV real
- **Por qué:** la docente pidió no implementar Computer Vision real y poner el esfuerzo en lo distribuido. Los frames son matrices NumPy con rectángulos (vehículos) y ruido. El conteo es un umbral de brillo más componentes conexas (`scipy.ndimage.label`), detrás de la interfaz `Detector` (Strategy).
- **Fuente:** comentario de la docente sobre la preentrega. Strategy y `scipy` son **[FUERA DE CLASE]**.
- **Qué queda validado** (no depende del contenido del frame): reparto entre workers, ACK después de guardar, DLQ, idempotencia, escalado, *claim check* y logs.
- **Trade-off aceptado: el detector simulado no funcionaría con video real.**
  - **Imagen:** sombras, faroles, autos oscuros, lluvia y autos superpuestos lo hacen contar mal.
  - **Preprocesamiento:** el descarte por diferencia de frames y la reducción de resolución están calibrados para la simulación. Con luz cambiante o una cámara que vibra hay que recalibrarlos, y un auto lejano puede perderse al reducir.
  - **Qué se mide:** `vehicle_count` es "autos visibles", un indicador razonable de congestión. Contar autos *que pasan* requiere seguirlos entre frames (*tracking*).
  - **Costo:** hoy son ~4 ms por clip. Un modelo real tarda unos 50 a 200 ms por frame en CPU, que es lo que representa `PROCESSING_DELAY_MS`.
- **Camino a CV real (trabajo futuro):**
  1. El edge lee video real (OpenCV) y comprime los clips. Pasan a color: `shape` cambia a `[alto, ancho, 3]`, un **cambio de contrato** (D2).
  2. Un `DetectorOpenCV` (sustracción de fondo MOG2 + contornos, sin entrenamiento) o un `DetectorYOLO` (modelo preentrenado) implementa `Detector.contar()`, y el worker no cambia.
  3. Se valida con videos de tránsito etiquetados: error absoluto medio del conteo contra la cantidad real.
  4. Se calibra el preprocesamiento y se mide cuántos workers (o GPU) hacen falta por cámara.
- **Cómo afecta:** el costo extra de un modelo real se absorbe escalando workers (`--scale`, D5). Un frame que rompe el modelo va a la DLQ (D6) y no tumba el sistema.
- **Alternativas descartadas por ahora:**
  - **YOLO preentrenado:** instala PyTorch, con imágenes de ~1,5 GB y builds lentos el día de la entrega; licencia AGPL; va contra el comentario docente.
  - **OpenCV clásico:** queda como extra opcional si sobra tiempo después de las demos, detrás de `DETECTOR=simulado|opencv` con `simulado` por defecto, para que las demos no dependan de él.

## D17. Demos con scripts reproducibles y resultados medidos
- **Por qué:** las demos (escalado, worker caído, idempotencia, DLQ y carga) tienen que poder repetirse en cualquier máquina del equipo y en la defensa, con el mismo resultado. Cada script solo usa Docker (`docker compose`, `rabbitmqctl`/`rabbitmqadmin` y `psql` dentro de los contenedores) y termina restaurando la configuración normal.
- **Fuente:**
  - Tema 1.2 p.7 (transparencia de fallo y de replicación) y p.21 (replicación para balancear la carga).
  - Tema 4.4 p.8–9 (re-encolado de mensajes sin ACK, competing consumers, DLQ).
  - Tema 2.0 p.15 (IX) y p.17 (X, paridad entre entornos).
- **Resultados** (evidencias 08 a 12):
  - **Escalado:** con 1 worker la cola crece ~2,5 mensajes/s; con 3 baja a 0 en ~55 s y el reparto queda parejo (173/170/170).
  - **Worker caído:** el mensaje en vuelo lo termina otra réplica (`redelivered: true`), sin pérdidas ni duplicados (36 = 36).
  - **Idempotencia:** 3 entregas del mismo clip dan 1 sola fila.
  - **DLQ:** el clip llega a `camera_dlq` con `x-death`.
  - **Carga:** 300 cámaras = 60 clips/s con 1 worker, sin cola ni `edge_lagging`; ~0,6 GB/min en MinIO.
- **Trade-off aceptado:**
  - Las demos de escalado y de worker caído usan `PROCESSING_DELAY_MS` (D13): sin eso, el CV simulado es tan rápido que no se vería el efecto.
  - Las demos con muchas cámaras escriben filas de cámaras e intersecciones que no existen en las tablas de Joaco G. El README trae el `DELETE` para limpiarlas.
  - `docker kill` cuenta como parada manual, así que `restart: unless-stopped` no relanza la víctima. Es buscado: se ve claro que otra réplica toma el trabajo.
  - Los scripts son bash: en Windows necesitan WSL o Git Bash.
- **Cómo afecta:**
  - Joaco G y Hernán corren las demos con la sección 4 del README.
  - Hernán saca las capturas de escalado y de fallo.
  - Iago usa las evidencias 08 a 12.
  - **Hallazgo de la carga:** el cuello de botella real va a ser el modelo de CV (D16), no la mensajería. Y la retención en MinIO deja de ser opcional en producción (D10).
- **Alternativa descartada:** demos manuales desde el panel de RabbitMQ. Son más visuales, pero no son reproducibles ni dejan evidencia en texto. Las capturas del panel se suman como complemento.

## D13. `PROCESSING_DELAY_MS`: demora artificial opcional en el worker
- **Por qué:** el CV simulado es tan rápido (milisegundos) que un solo worker vacía la cola y en la demo no se ve la diferencia entre 1 y 3 workers. Con una demora de, por ejemplo, 500 ms, la cola crece con 1 worker y baja con 3.
- **Fuente:** decisión para la demo (Tema 1.2 p.21, escalar para repartir la carga).
- **Trade-off aceptado:** es un parámetro "falso" que no existiría en producción. Por defecto vale 0, y en la demo se dice explícitamente que representa el costo de un modelo real.
- **Cómo afecta:** solo a la demo de escalado.
