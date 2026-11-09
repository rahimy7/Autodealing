import { Redirect } from "expo-router";
import { homeRoute, useAuth } from "../src/lib/auth";

// The root path only decides where the session belongs; every real screen lives
// under one of the two role groups.
export default function Index() {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;
  return <Redirect href={homeRoute(user)} />;
}
