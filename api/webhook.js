import { MercadoPagoConfig, Payment } from 'mercadopago'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const mp = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN })
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
const resend = new Resend(process.env.RESEND_API_KEY)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' })
  }

  const { type, data } = req.body

  // Solo procesar notificaciones de pagos
  if (type !== 'payment' || !data?.id) {
    return res.status(200).json({ received: true })
  }

  try {
    // 1. Obtener detalles del pago desde MercadoPago
    const payment = new Payment(mp)
    const paymentData = await payment.get({ id: data.id })

    const { status, external_reference } = paymentData

    if (!external_reference) {
      return res.status(200).json({ received: true })
    }

    // 2. Mapear estado de MP a nuestro sistema
    const nuevoEstado =
      status === 'approved' ? 'pagado' :
      status === 'rejected' ? 'fallido' :
      'pendiente'

    // 3. Actualizar registro en Supabase
    const { data: registro, error: dbError } = await supabase
      .from('registros')
      .update({
        estado: nuevoEstado,
        mp_payment_id: String(data.id),
      })
      .eq('id', external_reference)
      .select()
      .single()

    if (dbError) throw new Error(`Supabase update error: ${dbError.message}`)

    // 4. Si el pago fue aprobado, enviar emails de confirmación
    if (status === 'approved' && registro) {
      await Promise.all([
        resend.emails.send({
          from: `Papela Atelier <talleres@${process.env.RESEND_DOMAIN}>`,
          to: registro.usuario_email,
          subject: `¡Tu lugar en "${registro.taller_nombre}" está confirmado! 🎨`,
          html: emailUsuario(registro),
        }),
        resend.emails.send({
          from: `Sistema Papela <sistema@${process.env.RESEND_DOMAIN}>`,
          to: process.env.ADMIN_EMAIL,
          subject: `Nuevo apartado confirmado: ${registro.taller_nombre}`,
          html: emailAdmin(registro),
        }),
      ])
    }

    return res.status(200).json({ received: true })
  } catch (error) {
    console.error('[webhook] Error:', error.message)
    // Siempre respondemos 200 a MP para evitar reintentos
    return res.status(200).json({ received: true })
  }
}

// ─── Templates de email ───────────────────────────────────────────

function emailUsuario(registro) {
  const refCorta = registro.id.slice(0, 8).toUpperCase()
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#faf6f1;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:#3d2b1f;padding:40px;text-align:center;border-radius:12px 12px 0 0;">
              <h1 style="margin:0;color:#f5efe6;font-size:28px;letter-spacing:2px;">PAPELA ATELIER</h1>
              <p style="margin:8px 0 0;color:#c4a882;font-size:14px;">Talleres de papel y diseño</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:#fff;padding:48px 40px;">
              <h2 style="color:#3d2b1f;font-size:22px;margin:0 0 16px;">¡Hola, ${registro.usuario_nombre}! 🎉</h2>
              <p style="color:#5a4035;line-height:1.7;margin:0 0 24px;">
                Tu lugar está confirmado. Estamos muy emocionados de tenerte en el taller.
                Pronto te enviaremos todos los detalles de fecha, horario y lo que necesitas traer.
              </p>

              <!-- Detalles del taller -->
              <div style="background:#f5efe6;border-radius:10px;padding:28px;margin:0 0 28px;">
                <h3 style="color:#3d2b1f;margin:0 0 16px;font-size:18px;">${registro.taller_nombre}</h3>
                <table cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding:6px 0;color:#8b6914;font-size:14px;width:140px;"><strong>Monto pagado</strong></td>
                    <td style="padding:6px 0;color:#3d2b1f;font-size:14px;">$${Number(registro.monto).toLocaleString('es-MX')} MXN</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;color:#8b6914;font-size:14px;"><strong>Referencia</strong></td>
                    <td style="padding:6px 0;color:#3d2b1f;font-size:14px;">${refCorta}</td>
                  </tr>
                </table>
              </div>

              <p style="color:#5a4035;line-height:1.7;margin:0 0 8px;">Si tienes alguna pregunta, responde a este correo y con gusto te ayudamos.</p>
              <p style="color:#5a4035;margin:0;">Con cariño,<br><strong>Equipo Papela Atelier</strong></p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f5efe6;padding:24px;text-align:center;border-radius:0 0 12px 12px;">
              <p style="margin:0;color:#8b6914;font-size:12px;">© 2026 Papela Atelier · Puebla, México</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `
}

function emailAdmin(registro) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table width="560" style="max-width:560px;width:100%;background:#fff;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="background:#3d2b1f;padding:24px 32px;">
              <h2 style="margin:0;color:#f5efe6;font-size:18px;">🎨 Nuevo apartado confirmado</h2>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                ${fila('Taller', registro.taller_nombre)}
                ${fila('Alumno', registro.usuario_nombre)}
                ${fila('Email', registro.usuario_email)}
                ${fila('Teléfono', registro.usuario_telefono || '—')}
                ${fila('Monto', `$${Number(registro.monto).toLocaleString('es-MX')} MXN`)}
                ${fila('Estado', '✅ Pagado')}
                ${fila('ID Supabase', registro.id)}
                ${fila('ID Pago MP', registro.mp_payment_id)}
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `
}

function fila(label, valor) {
  return `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#888;font-size:13px;width:140px;">${label}</td>
      <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#222;font-size:13px;">${valor}</td>
    </tr>
  `
}
