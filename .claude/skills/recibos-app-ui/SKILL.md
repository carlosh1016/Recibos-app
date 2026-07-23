---
name: recibos-app-ui
description: >
  Diseño e implementación de la interfaz de usuario para Recibos App, una PWA
  móvil que ayuda a contadoras colombianas a fotografiar facturas y exportarlas
  a Excel. Usar este skill siempre que Carlos pida mejorar la UI, rediseñar
  pantallas, cambiar estilos, mejorar la experiencia de usuario, ajustar
  componentes visuales, o cuando mencione que algo "se ve mal", "está saturado",
  "no es amigable" o "quiero que se vea mejor". También activar cuando pida
  crear componentes nuevos para la app o ajustar el flujo de navegación.
---

# Recibos App — UI Skill

## Contexto del producto

App para la mamá de Carlos (contadora) y ~5 colegas suyas. Procesa lotes de
facturas colombianas: foto → extracción con Gemini API → revisión → exportar
a Excel con el formato exacto "FACTURAS DE COMPRA" del cliente.

**Usuario real:** contadoras, no developers. Usan el celular en la oficina,
a veces con prisa. No toleran interfaces confusas ni pasos innecesarios.

**Flujo de 4 pantallas:**
```
Home → Capture → Review → Export
```

---

## Identidad visual

### Paleta
```
--color-primary:     #1B4FD8   azul institucional, acciones principales
--color-primary-light: #EEF2FF fondo suave de áreas activas
--color-success:     #16A34A   facturas OK, confirmaciones
--color-warning:     #D97706   facturas para revisar, alertas suaves
--color-error:       #DC2626   errores, facturas con problema
--color-surface:     #FFFFFF   fondo de tarjetas
--color-bg:          #F8FAFC   fondo de página
--color-text:        #0F172A   texto principal
--color-muted:       #64748B   texto secundario, hints
--color-border:      #E2E8F0   bordes suaves
```

### Tipografía
- **Display / títulos:** `font-semibold`, tamaño generoso, color `--color-text`
- **Body:** sistema nativo del dispositivo (`font-family: system-ui`)
- **Monoespaciado (NIT, número factura):** `font-mono` — datos que parecen datos
- **Regla:** nunca más de 2 pesos de fuente por pantalla

### Espaciado y radio
- Padding de tarjetas: `p-4` (16px)
- Radio de elementos interactivos: `rounded-xl` (12px)
- Radio de badges/chips: `rounded-full`
- Gap entre elementos de lista: `gap-3`
- Margen seguro inferior en móvil: `pb-safe` o `pb-6`

### Botones
```
Primario:   bg-blue-700 text-white rounded-xl py-3 px-6 font-semibold
            w-full en móvil, activo con sombra suave
Secundario: border border-gray-200 bg-white text-gray-700 rounded-xl
Destructivo: text-red-600, sin fondo hasta hover
Tamaño mínimo área táctil: 44px alto
```

---

## Principios de diseño para esta app

### 1. Una sola acción por pantalla
Cada pantalla tiene UN botón principal obvio. Todo lo demás es contexto.
- Home: "Nueva sesión"
- Capture: "Tomar foto" (o el resultado inmediato después de tomar)
- Review: "Marcar revisado" / "Siguiente"
- Export: "Exportar a Excel"

### 2. El estado siempre es visible
La usuaria nunca debe adivinar qué pasó o qué falta:
- Contadores visibles: "3 de 12 revisados"
- Badges de estado en cada factura: verde / amarillo / rojo
- Progreso de OCR con porcentaje real (no spinner mudo)
- Feedback inmediato después de cada acción

### 3. Nada sin propósito
Si un elemento no ayuda a completar la tarea principal, no va.
- Sin decoración que no sea información
- Sin tooltips que expliquen cosas que deberían ser obvias
- Sin modales para confirmar acciones reversibles
- Los errores dicen exactamente qué salió mal y cómo arreglarlo

### 4. Móvil primero, siempre
- Thumb zone: botones principales abajo o al centro
- Texto legible sin zoom: mínimo 16px en body, 14px en secundario
- Touch targets: mínimo 44×44px
- Sin hover-only interactions

---

## Pantallas — especificaciones

### Home
**Objetivo:** crear o continuar una sesión de trabajo rápido.

```
┌─────────────────────────────┐
│  Recibos App          [⚙]  │  header minimal
├─────────────────────────────┤
│                             │
│   [Ícono factura grande]    │  hero simple, no decorativo
│   Sesiones recientes        │
│                             │
│  ┌─────────────────────┐   │
│  │ Sesión empresa X    │   │  lista de sesiones previas
│  │ 12 facturas · hoy   │   │  tap para continuar
│  └─────────────────────┘   │
│                             │
│  [+ Nueva sesión]           │  botón primario, abajo
└─────────────────────────────┘
```

**Componentes:**
- Lista de sesiones recientes (máx 5, enlace "ver todas" si hay más)
- Cada sesión: nombre, conteo de facturas, fecha, estado (completa/pendiente)
- Botón FAB o bottom-bar para nueva sesión

### Capture
**Objetivo:** tomar fotos rápido, sin fricción, una tras otra.

```
┌─────────────────────────────┐
│  ← Sesión X      [3 fotos] │
├─────────────────────────────┤
│                             │
│  ┌─ ─ ─ ─ ─ ─ ─ ─ ─ ─┐   │
│  ╎   Centra la factura  ╎   │  recuadro guía punteado
│  ╎   en este recuadro   ╎   │
│  └─ ─ ─ ─ ─ ─ ─ ─ ─ ─┘   │
│                             │
│  [████████████  60%]        │  barra progreso OCR (solo cuando procesa)
│  Reconociendo texto...      │
│                             │
│     [📷 Tomar foto]         │  botón principal
│   [Ir a revisar →]          │  secundario, solo si hay ≥1 factura
└─────────────────────────────┘
```

**Estados de la barra de progreso:**
- Oculta cuando no hay procesamiento activo
- Azul con % real de Gemini mientras procesa
- Verde "✓ Listo" por 2s antes de volver a idle
- Roja con mensaje de error específico si falla

**Después de tomar foto:** mostrar thumbnail de la foto + spinner pequeño
mientras procesa. La usuaria puede tomar otra foto sin esperar.

### Review
**Objetivo:** revisar y corregir los datos extraídos, uno por uno.

```
┌─────────────────────────────┐
│  ← Revisar      2 de 12    │
├─────────────────────────────┤
│ ┌─────────┐  ● Para revisar│  foto + badge estado
│ │  [foto] │                │
│ │         │  CENTRAL PAR.. │  razón social grande
│ └─────────┘  830.087.099-3 │  NIT en mono
├─────────────────────────────┤
│ Razón social               │
│ [Central Parking System   ]│  campos editables
│ NIT          DV            │
│ [830087099 ] [3]           │
│ No. Factura  Fecha         │
│ [CFLA 1915 ] [2026-05-16]  │
│ Base (VALOR)   % IVA       │
│ [11,848.74  ]  [19%    ]   │
├─────────────────────────────┤
│ ⚠ base + IVA ≠ total       │  alerta inline si no cuadra
│ Total leído: $14,100        │
├─────────────────────────────┤
│ Concepto                   │
│ [PARQUEO - Normal         ]│
│ Forma de pago              │
│ ○ Contado  ○ Crédito       │
├─────────────────────────────┤
│ [✓ Marcar revisado]        │  primario
│ [Siguiente →]              │  secundario
└─────────────────────────────┘
```

**Reglas de campos:**
- Campos con baja confianza del OCR: borde amarillo + ícono ⚠
- Si base+IVA ≠ total: resaltar los tres campos en amarillo
- NIT y DV siempre en `font-mono`
- Fecha como `<input type="date">` — teclado nativo del celular
- "Marcar revisado" deshabilitado hasta que NIT tenga formato válido

**Navegación entre facturas:**
- Swipe horizontal (si se implementa) o botones anterior/siguiente
- Contador prominente: "2 de 12" con mini-barra de progreso

### Export
**Objetivo:** generar y descargar el Excel con un tap.

```
┌─────────────────────────────┐
│  ← Exportar                │
├─────────────────────────────┤
│                             │
│  Sesión: Empresa X          │
│                             │
│  ✅ 10  revisadas           │
│  ⚠️  2   pendientes         │  resumen claro antes de exportar
│  ─────────────────          │
│  Total: 12 facturas         │
│                             │
│  ┌─────────────────────┐   │
│  │ ⚠ Tienes 2 facturas │   │  aviso si hay pendientes,
│  │ sin revisar. Puedes │   │  NO bloquear la exportación
│  │ exportarlas igual.  │   │
│  └─────────────────────┘   │
│                             │
│  [↓ Exportar a Excel]       │  botón primario
│                             │
└─────────────────────────────┘
```

**Después de exportar:**
- Toast de éxito: "✓ Excel descargado"
- Opción clara: "Nueva sesión" para empezar otra empresa

---

## Componentes reutilizables

### ReceiptCard (lista en Review)
```tsx
// Estado visual por status
ok:     border-l-4 border-green-500  bg-white
review: border-l-4 border-yellow-400 bg-yellow-50
error:  border-l-4 border-red-400    bg-red-50
```

### StatusBadge
```tsx
ok:     "✓ OK"        bg-green-100  text-green-700
review: "⚠ Revisar"  bg-yellow-100 text-yellow-700
error:  "✗ Error"    bg-red-100    text-red-700
```

### ProgressBar
```tsx
// Solo visible cuando hay actividad
// Nunca simular progreso — usar valor real de Gemini
// Si tarda >10s sin completar: "Procesando... (puede tomar un momento)"
```

### FieldWithConfidence
```tsx
// Envuelve cualquier input para mostrar confianza del OCR
low:    border-yellow-300 + ícono ⚠ a la derecha
high:   border-gray-200 normal
error:  border-red-300
```

---

## Lo que NO va en esta UI

- Animaciones de entrada en cada elemento (una sola, si acaso, en la transición de pantalla)
- Modales de confirmación para acciones que se pueden deshacer
- Tooltips de explicación para acciones obvias
- Textos de marketing dentro de la app ("¡Ahorra tiempo con Recibos App!")
- Gradientes decorativos sin función
- Íconos sin etiqueta en acciones importantes
- Más de 2 botones de igual peso visual en una pantalla

---

## Implementación con Tailwind

Al generar código, usar clases de Tailwind v3. Convenciones:

```tsx
// Contenedor de pantalla
<div className="min-h-screen bg-slate-50 flex flex-col">

// Header de pantalla
<header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3">

// Tarjeta
<div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">

// Botón primario
<button className="w-full bg-blue-700 hover:bg-blue-800 text-white font-semibold 
                   py-3 px-6 rounded-xl transition-colors active:scale-95">

// Botón secundario
<button className="w-full border border-slate-200 bg-white text-slate-700 
                   font-medium py-3 px-6 rounded-xl transition-colors">

// Campo de texto
<input className="w-full border border-slate-200 rounded-lg px-3 py-2 
                  text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">

// Label de campo
<label className="block text-xs font-medium text-slate-500 mb-1 uppercase tracking-wide">
```

---

## Checklist antes de entregar cualquier pantalla

- [ ] ¿Hay una sola acción principal obvia?
- [ ] ¿El estado actual es visible sin adivinar?
- [ ] ¿Todos los touch targets son ≥ 44px?
- [ ] ¿Los errores dicen qué pasó y cómo arreglarlo?
- [ ] ¿Funciona bien en pantalla de 375px de ancho?
- [ ] ¿Se quitó todo lo que no tiene propósito?