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
