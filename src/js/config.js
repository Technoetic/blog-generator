// config.js — API 키, 모델 설정, OAuth 설정
class Config {
	static BIZROUTER_URL = "/api/bizrouter";
	static MODEL = "google/gemini-2.5-flash-lite";
	static WRITER_MODEL = "google/gemini-2.5-flash";
	static IMAGE_MODEL = "google/gemini-2.5-flash-image";
	static IMGUR_PROXY_URL = "/api/imgur-upload";
	static GOOGLE_CLIENT_ID =
		"835887967219-16jq3t5opvkumi55q6c63cglq9ksncg6.apps.googleusercontent.com";
	static BLOGGER_SCOPE = "https://www.googleapis.com/auth/blogger";
	static PHASES = [
		"phase1",
		"phase2a",
		"phase2b",
		"phase3a",
		"phase3b",
		"phase3c",
		"phase4",
		"phase5",
	];
}
