import dotenv from "dotenv";
dotenv.config();
import express, { Request, Response } from "express";
import { sendEmail } from "./services/emailService";
import { supabase } from "./db/supabaseClient";
import { generateOtp, getOtpExpiry } from "./utils/otp";
import { generateToken } from "./utils/jwt";
import { authenticate } from "./middleware/authMiddleware";
import  challengeRoutes from "./routes/challenges";
import  dashboardRoutes from "./routes/dashboard";
//import { sendEmail } from "./services/emailService";

//import cors from "cors";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 4000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use("/challenges", challengeRoutes);
app.use(dashboardRoutes)

// Test route
app.get("/test-endpoint", (req: Request, res: Response) => {
  res.json({ status: "Backend is running 🚀" });
});

//Test mailinator
app.get("/test-email", async (req, res) => {
  try {
    await sendEmail(
      "otpmailinator@gmail.com",
      "Test Email from Backend",
      "If you received this, email setup works 🎉"
    );

    res.json({ message: "Email sent successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to send email" });
  }
});

//send otp for signup
app.post("/auth/signup/send-otp", async (req, res) => {
  try {
    const { name, email } = req.body;

    if (!name || !email) {
      return res.status(400).json({ message: "Name and email are required" });
    }

    // 1️⃣ Check if user already exists
    const { data: user } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .single();

    if (user) {
      return res.status(400).json({ message: "User already exists" });
    }

    // 2️⃣ Generate OTP
    const otp = generateOtp();
    const expiry = getOtpExpiry();

    // 3️⃣ Store OTP
    await supabase.from("email_otps").insert({
      email,
      otp,
      expires_at: expiry,
    });

    // 4️⃣ Send OTP email
    await sendEmail(
      email,
      "Your Signup OTP",
      `Your OTP is ${otp}. It is valid for 5 minutes.`
    );

    res.json({ message: "Signup OTP sent successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});


// verify the otp for signup
app.post("/auth/signup/verify-otp", async (req, res) => {
  try {
    const { name, email, otp } = req.body;

    if (!name || !email || !otp) {
      return res
        .status(400)
        .json({ message: "Name, email and OTP are required" });
    }

    // 1️⃣ Find valid OTP
    const { data: otpRecord, error: Error } = await supabase
      .from("email_otps")
      .select("*")
      .eq("email", email)
      .eq("otp", otp)
      .eq("is_used", false)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!otpRecord) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    // 2️⃣ Mark OTP as used
    await supabase
      .from("email_otps")
      .update({ is_used: true })
      .eq("id", otpRecord.id);

    // 3️⃣ Create user
    const { data: newUser, error } = await supabase
      .from("users")
      .insert({
        name,
        email,
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ message: "Failed to create user" });
    }

    res.json({
      message: "Signup successful",
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

//send otp for signin
app.post("/auth/signin/send-otp", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    // 1️⃣ Check if user exists
    const { data: user } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .single();

    // const { data: user, error } = await supabase
    // .from("users")
    // .select("id, email")
    // .eq("email", email)
    // .maybeSingle();

    if (!user) {
      return res.status(400).json({ message: "User not registered" });
    }

    // 2️⃣ Generate OTP
    const otp = generateOtp();
    const expiry = getOtpExpiry();

    // 3️⃣ Store OTP
    await supabase.from("email_otps").insert({
      email,
      otp,
      expires_at: expiry,
    });

    // 4️⃣ Send OTP email
    await sendEmail(
      email,
      "Your Sign In OTP",
      `Your OTP is ${otp}. Valid for 5 minutes.`
    );

    res.json({ message: "Signin OTP sent successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

//verify signin otp
app.post("/auth/signin/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ message: "Email and OTP required" });
    }

    // 1️⃣ Validate OTP
    const { data: otpRecord } = await supabase
      .from("email_otps")
      .select("*")
      .eq("email", email)
      .eq("otp", otp)
      .eq("is_used", false)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!otpRecord) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    // 2️⃣ Mark OTP as used
    await supabase
      .from("email_otps")
      .update({ is_used: true })
      .eq("id", otpRecord.id);

    // 3️⃣ Issue JWT
    const token = generateToken(email);

    res.json({
      message: "Signin successful",
      token,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

//authorization
app.get("/profile", authenticate, (req, res) => {
  res.json({
    message: "Protected data accessed",
    user: (req as any).user,
  });
});


// Start server
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
