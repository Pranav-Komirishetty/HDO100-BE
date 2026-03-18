import nodemailer from "nodemailer";

export async function sendEmail(
  to: string,
  subject: string,
  text: string
) {
  console.log("📧 Preparing to send email...");
  console.log("TO:", to);
  console.log("USER:", process.env.EMAIL_USER);

  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false, // TLS
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });

    console.log("🔌 Verifying SMTP connection...");

    await transporter.verify();

    console.log("✅ SMTP connection verified");

    const info = await transporter.sendMail({
      from: `"HDO100" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      text,
    });

    console.log("✅ Email sent successfully");
    console.log("Message ID:", info.messageId);
  } catch (error: any) {
    console.error("❌ EMAIL ERROR FULL:", error);

    if (error.code) console.error("Error Code:", error.code);
    if (error.response) console.error("SMTP Response:", error.response);
    if (error.command) console.error("SMTP Command:", error.command);

    throw error;
  }
}