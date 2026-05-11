import { MercadoPagoConfig, Preference } from 'mercadopago'
import { createClient } from '@supabase/supabase-js'

const mp = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN })
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

export default async function handler(req, res) {
  // Solo permitir POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' })
  }

  // CORS para Framer
  res.setHeader('Access-Control-Allow-Origin', process.env.SITE_URL || '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  const {
    taller_nombre,
    taller_id,
    monto,
    monto_unitario,
    cantidad,
    usuario_nombre,
    usuario_email,
    usuario_telefono,
  } = req.body

  // Validar campos requeridos
  if (!taller_nombre || !taller_id || !monto || !usuario_nombre || !usuario_email) {
    return res.status(400).json({ error: 'Faltan campos requeridos' })
  }

  const cantidadNum = Number(cantidad) || 1
  const precioUnitario = Number(monto_unitario) || Number(monto)
  const montoTotal = precioUnitario * cantidadNum

  try {
    // 1. Guardar registro en Supabase con estado "pendiente"
    const { data: registro, error: dbError } = await supabase
      .from('registros')
      .insert({
        taller_nombre,
        taller_id,
        usuario_nombre,
        usuario_email,
        usuario_telefono: usuario_telefono || null,
        monto: montoTotal,
        cantidad: cantidadNum,
        estado: 'pendiente',
      })
      .select()
      .single()

    if (dbError) throw new Error(`Supabase error: ${dbError.message}`)

    // 2. Crear preferencia en MercadoPago
    const preference = new Preference(mp)
    const mpResponse = await preference.create({
      body: {
        items: [
          {
            title: taller_nombre,
            quantity: cantidadNum,
            unit_price: precioUnitario,
            currency_id: 'MXN',
          },
        ],
        payer: {
          name: usuario_nombre,
          email: usuario_email,
        },
        back_urls: {
          success: `${process.env.SITE_URL}/confirmacion?estado=exitoso&ref=${registro.id}`,
          failure: `${process.env.SITE_URL}/confirmacion?estado=fallido`,
          pending: `${process.env.SITE_URL}/confirmacion?estado=pendiente`,
        },
        auto_return: 'approved',
        // external_reference liga el pago con nuestro registro en Supabase
        external_reference: registro.id,
        // MP llamará a este endpoint cuando el pago se confirme
        notification_url: `${process.env.VERCEL_URL}/api/webhook`,
      },
    })

    // 3. Guardar el preference_id en Supabase
    await supabase
      .from('registros')
      .update({ mp_preference_id: mpResponse.id })
      .eq('id', registro.id)

    // 4. Devolver la URL de pago de MercadoPago
    return res.status(200).json({
      checkout_url: mpResponse.init_point, // URL de producción
      // sandbox_url: mpResponse.sandbox_init_point, // usar en pruebas
    })
  } catch (error) {
    console.error('[checkout] Error:', error.message)
    return res.status(500).json({ error: 'Error al procesar el pago. Intenta de nuevo.' })
  }
}
