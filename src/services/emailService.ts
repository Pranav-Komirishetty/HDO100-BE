// @ts-ignore
import SibApiV3Sdk from 'sib-api-v3-sdk';

const client = SibApiV3Sdk.ApiClient.instance;
const apiKey = client.authentications["api-key"];

apiKey.apiKey = process.env.BREVO_API_KEY!;

const emailApi = new SibApiV3Sdk.TransactionalEmailsApi();

export async function sendEmail(
  to: string,
  subject: string,
  text: string
) {
  try {
    await emailApi.sendTransacEmail({
      sender: {
        email: "otpmailinator@gmail.com",
        name: "HDO100",
      },
      to: [{ email: to }],
      subject,
      textContent: text,
    });

    console.log("Email sent via Brevo");
  } catch (error) {
    console.error("EMAIL ERROR:", error);
    throw error;
  }
}