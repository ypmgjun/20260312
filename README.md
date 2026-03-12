# 도미노피자 재고·발주 자동화

재고를 파악하고, 부족 시 담당 거래처에 발주서 이메일을 보내는 웹 시스템입니다.

## 배포 (Vercel)

1. [Vercel](https://vercel.com)에 GitHub 저장소 연결
2. 환경 변수 설정:
   - `TEAM_PASSWORD`: 팀 비밀번호 (웹 접속 시 입력)
   - `GMAIL_USER`: chonf.yjji@gmail.com
   - `GMAIL_APP_PASSWORD`: Gmail 앱 비밀번호

## 로컬 실행

```bash
npm install
npm start
```

`.env` 파일에 위 환경 변수 설정 (`.env.example` 참고)

## 데이터

- **sampleData/domino_inventory_training.xlsx**: 샘플 데이터

## 주요 기능

- 팀 비밀번호 인증
- 웹에서 거래처/재고 입력
- 재고 부족 시 발주 이메일 발송
