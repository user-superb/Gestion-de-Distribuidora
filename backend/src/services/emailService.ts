import { Resend } from 'resend';

let resendClient: Resend | null = null;

function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return null;
  }
  if (!resendClient) {
    resendClient = new Resend(apiKey);
  }
  return resendClient;
}

export interface SendPasswordResetEmailParams {
  to: string;
  resetUrl: string;
}

export async function sendPasswordResetEmail({ to, resetUrl }: SendPasswordResetEmailParams): Promise<{ success: boolean; id?: string; error?: string }> {
  const resend = getResendClient();
  const fromEmail = process.env.EMAIL_FROM || 'onboarding@resend.dev';

  if (!resend) {
    console.warn('[emailService] RESEND_API_KEY no está configurada. Correo de recuperación no enviado.');
    return { success: false, error: 'RESEND_API_KEY not configured' };
  }

  try {
    const result = await resend.emails.send({
      from: fromEmail,
      to,
      subject: 'Recuperación de contraseña - Gestión de Distribuidora',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #1e293b; margin-top: 0;">Restablecimiento de contraseña</h2>
          <p style="color: #475569; font-size: 15px; line-height: 1.5;">
            Hemos recibido una solicitud para restablecer la contraseña de su cuenta en el sistema de Gestión de Distribuidora.
          </p>
          <p style="color: #475569; font-size: 15px; line-height: 1.5;">
            Haga clic en el siguiente enlace para continuar. Este enlace es de <strong>uso único</strong> y vencerá en <strong>20 minutos</strong>:
          </p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
              Restablecer mi contraseña
            </a>
          </div>
          <p style="color: #64748b; font-size: 13px; line-height: 1.5;">
            Si el botón no funciona, copie y pegue el siguiente enlace en su navegador:<br>
            <span style="word-break: break-all; color: #2563eb;">${resetUrl}</span>
          </p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 25px 0;" />
          <p style="color: #94a3b8; font-size: 12px; margin-bottom: 0;">
            Si usted no solicitó este cambio, puede ignorar este mensaje de forma segura. Su contraseña actual no sufrirá modificaciones.
          </p>
        </div>
      `,
      text: `Hemos recibido una solicitud para restablecer su contraseña en el sistema de Gestión de Distribuidora.\n\nAcceda al siguiente enlace para continuar (válido por 20 minutos y de uso único):\n${resetUrl}\n\nSi usted no solicitó este cambio, puede ignorar este mensaje.`
    });

    if (result.error) {
      console.error('[emailService] Error devuelto por el servicio de correo:', result.error.name);
      return { success: false, error: result.error.message };
    }

    return { success: true, id: result.data?.id };
  } catch (err: any) {
    console.error('[emailService] Error inesperado en el envío de correo:', err?.message || err);
    return { success: false, error: err?.message || 'Unknown error' };
  }
}
