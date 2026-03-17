import jwt from "jsonwebtoken";

export const generateToken = (email: string): string => {
  return jwt.sign(
    { email },
    process.env.JWT_SECRET!,
    { expiresIn: "1h" }
  );
};
