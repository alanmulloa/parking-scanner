# Edge Functions - siguiente fase

Todavía no se despliega ninguna Edge Function.

La migración v1 solo prepara base, relaciones, restricciones y RLS. Las primeras funciones previstas son:

- `admin-user-password`: alta/reset administrativo de usuario y envío de correo.
- `vehicle-create`: alta atómica de vehículo con Slot 1 -> Slot 2 -> Desasignado.
- `incident-document`: generación/exportación del expediente si se retira Google Drive.

Nunca guardar `service_role` en GitHub Pages ni en archivos versionados del frontend.
