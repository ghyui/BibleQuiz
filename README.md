# 성경 퀴즈 (소년부)

소년부 성경 퀴즈 웹사이트. 순수 HTML/CSS/JS로 작성되어 별도 빌드 없이 GitHub Pages에서 바로 호스팅됩니다.

## 기능

- **퀴즈 풀기**: 무작위 출제, 5/10/20/전체 문제 수 선택, 즉시 채점
- **문제집 보기**: 전체 문제와 정답을 검색 가능한 목록으로 열람

## 로컬에서 보기

별도 빌드 없이 `index.html`을 브라우저로 열면 됩니다. 또는:

```powershell
# Python 3가 설치돼 있다면
python -m http.server 8000
# → http://localhost:8000
```

## 배포 (GitHub Pages)

1. 이 저장소를 `main` 브랜치에 push
2. GitHub repo → **Settings → Pages**
3. **Source**: Deploy from a branch → **Branch**: `main` / **Folder**: `/ (root)` → Save
4. 잠시 후 `https://<username>.github.io/BibleQuiz/`에서 확인

## 문제 추가하기

`js/questions.js` 파일의 `window.QUESTIONS` 배열에 항목을 추가합니다:

```js
{
  q: "문제 내용",
  options: ["선택지1", "선택지2", "선택지3", "선택지4"],
  answer: 2,           // 정답 인덱스 (0부터 시작)
  ref: "창세기 1장"     // (선택) 성경 참조
}
```

## 구조

```
BibleQuiz/
├── index.html        # 메인 페이지
├── css/style.css     # 스타일
├── js/
│   ├── questions.js  # 문제 데이터
│   └── app.js        # 앱 로직
└── README.md
```
