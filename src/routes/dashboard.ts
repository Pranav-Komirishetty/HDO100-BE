import express, { Request, Response } from "express";
import { supabase } from "../db/supabaseClient";
import { authenticate } from "../middleware/authMiddleware";
import { getEffectiveDate } from "../utils/dateUtils";

const router = express.Router();

router.get("/dashboard", authenticate, async (req: Request, res: Response) => {
  const user = (req as any).user;

  try {
    // 1️⃣ Get user
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("email", user.email)
      .single();

    if (userError) throw userError;

    // 2️⃣ Get default active challenge
    const { data: challenge } = await supabase
      .from("challenges")
      .select("*")
      .eq("user_id", userData.id)
      .eq("is_default", true)
      .eq("status", "active")
      .maybeSingle();

    if (!challenge) {
      return res.json({ dashboard: null });
    }

    const effectiveToday = getEffectiveDate(challenge.timezone_snapshot);

    // 3️⃣ Calculate current day number
    const start = new Date(challenge.start_date);
    const todayDate = new Date(effectiveToday);
    const diffTime = todayDate.getTime() - start.getTime();
    const currentDay =
      diffTime >= 0 ? Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1 : 0;

    // 4️⃣ Get all logs
    const { data: logs } = await supabase
      .from("daily_logs")
      .select("*")
      .eq("challenge_id", challenge.id);

    const totalScore =
      logs?.reduce((sum: number, log: any) => sum + log.total_score, 0) || 0;

    const daysLogged =
      logs?.filter((log: any) => log.is_logged_by_user).length || 0;

    const completionPercent =
      challenge.total_days > 0
        ? Math.round((daysLogged / challenge.total_days) * 100)
        : 0;

    // 5️⃣ Compute streak
    let streak = 0;

    if (currentDay > 0) {
      const logMap = new Map();
      for (const log of logs || []) {
        logMap.set(log.date_local, log);
      }

      for (let day = currentDay; day >= 1; day--) {
        const date = new Date(start);
        date.setDate(start.getDate() + (day - 1));

        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, "0");
        const dd = String(date.getDate()).padStart(2, "0");

        const dateStr = `${yyyy}-${mm}-${dd}`;

        const log = logMap.get(dateStr);

        if (log && log.total_score > 0) {
          streak++;
        } else {
          break;
        }
      }
    }

    // 6️⃣ Build 21-day grid
    const grid: any[] = [];

    if (currentDay > 0) {
      let gridStartDay: number;

      if (currentDay <= 21) {
        gridStartDay = 1;
      } else {
        gridStartDay = currentDay - 20;
      }

      let gridEndDay = gridStartDay + 20;

      if (gridEndDay > challenge.total_days) {
        gridEndDay = challenge.total_days;
        gridStartDay = Math.max(1, gridEndDay - 20);
      }

      for (let dayIndex = gridStartDay; dayIndex <= gridEndDay; dayIndex++) {
        const date = new Date(start);
        date.setDate(start.getDate() + (dayIndex - 1));

        const dateStr = date.toISOString().split("T")[0];

        const log = logs?.find((l: any) => l.date_local === dateStr);

        grid.push({
          day_number: dayIndex,
          date: dateStr,
          is_today: dayIndex === currentDay,
          score: log ? log.total_score : 0,
          is_future: dayIndex > currentDay,
          logged: log ? log.is_logged_by_user : false,
        });
      }
    }

    // 🗓 Build Full Month Calendar

    const logMap = new Map();
    for (const log of logs || []) {
      logMap.set(log.date_local, log);
    }

    const startDate = new Date(challenge.start_date);
    const endDate = new Date(challenge.end_date);
    const todayStr = effectiveToday;

    const calendarMonths = [];

    let cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);

    let dayNumber = 0;
    while (cursor <= endDate) {
      const year = cursor.getFullYear();
      const month = cursor.getMonth();

      const firstDayOfMonth = new Date(year, month, 1);
      const lastDayOfMonth = new Date(year, month + 1, 0);
      const daysInMonth = lastDayOfMonth.getDate();

      const monthLabel = firstDayOfMonth.toLocaleString("default", {
        month: "long",
        year: "numeric",
      });

      const days = [];

      for (let day = 1; day <= daysInMonth; day++) {
        const dateObj = new Date(year, month, day);
        const yyyy = dateObj.getFullYear();
        const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
        const dd = String(dateObj.getDate()).padStart(2, "0");

        const dateStr = `${yyyy}-${mm}-${dd}`;

        const inRange =
          dateStr >= challenge.start_date && dateStr <= challenge.end_date;
        inRange ? dayNumber++ : dayNumber;

        const isToday = dateStr === todayStr;
        const isFuture = dateStr > todayStr;

        const log = logMap.get(dateStr);

        days.push({
          date: dateStr,
          in_range: inRange,
          is_today: isToday,
          is_future: isFuture,
          day_number: dayNumber,
          total_score: log?.total_score ?? 0,
          is_logged_by_user: log?.is_logged_by_user ?? false,
        });
      }

      calendarMonths.push({
        label: monthLabel,
        year,
        month,
        days,
      });

      cursor = new Date(year, month + 1, 1);
    }

    // 7️⃣ Today’s score
    const todayLog = logs?.find((l: any) => l.date_local === effectiveToday);

    const todayScore = todayLog ? todayLog.total_score : 0;

    // 8️⃣ Max possible score per day
    const { data: tasks } = await supabase
      .from("challenge_tasks")
      .select("points")
      .eq("challenge_id", challenge.id);

    const maxDailyScore =
      tasks?.reduce((sum: number, t: any) => sum + t.points, 0) || 0;

    res.json({
      challenge: {
        id: challenge.id,
        name: challenge.name,
      },
      current_day: currentDay,
      total_days: challenge.total_days,
      total_score: totalScore,
      completion_percent: completionPercent,
      streak,
      today_score: todayScore,
      max_daily_score: maxDailyScore,
      grid_21_days: grid,
      calendar: {
        months: calendarMonths,
      },
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
