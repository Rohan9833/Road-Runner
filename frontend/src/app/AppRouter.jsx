import { Navigate, Route, Routes } from "react-router-dom";
import HomePage from "../pages/HomePage.jsx";
import PlayPage from "../pages/PlayPage.jsx";
import NotFoundPage from "../pages/NotFoundPage.jsx";
export function AppRouter() {
  return <Routes><Route path="/" element={<HomePage />} /><Route path="/play" element={<PlayPage />} /><Route path="/home" element={<Navigate to="/" replace />} /><Route path="*" element={<NotFoundPage />} /></Routes>;
}