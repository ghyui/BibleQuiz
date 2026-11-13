# 성경 퀴즈 (소년부)

소년부 성경 퀴즈 웹사이트. 순수 HTML/CSS/JS로 작성되어 별도 빌드 없이 GitHub Pages에서 바로 호스팅됩니다.

## 기능

- **퀴즈 풀기**: 무작위 출제, 5/10/20/전체 문제 수 선택, 즉시 채점
- **문제집 보기**: 전체 문제와 정답을 검색 가능한 목록으로 열람
- **시편 23편 외우기** (개역한글): 난이도(쉬움/보통/어려움)에 따라 단어를 빈칸으로 바꿔 출제
  - 암송 연습: 빈칸마다 바로 채점하고, 틀린 칸에는 힌트가 자동으로 붙음(글자수 → 초성 → 한 글자씩, 글자 수가 맞으면 맞은 글자는 그대로 보여 주고 틀린 자리만 힌트). 모두 맞출 때까지 반복
  - 암송 실전: 10문제를 다 푼 뒤 한 번에 채점하고 빈칸별 리포트 표시
  - 암송 오답노트: 틀린 구절만 반복, 3번 연속 맞히면 제외
  - 전체 쓰기(최종): 1~6절을 직접 쓰고 채점, 틀린 절만 다시 쓰기

암송 구절 본문은 `js/questions.js`의 `window.MEMORY_VERSE`에 있습니다. 긴 절은 `parts`로 나눈 한 부분이 한 문제가 됩니다.

## 로컬에서 보기

처음 내려받았다면 `js/firebase-config.example.js`를 `js/firebase-config.js`로 복사하고 Firebase 콘솔의 웹 앱 설정 값을 입력합니다. 실제 설정 파일은 Git에서 제외됩니다. 기존 작업 폴더에는 기존 값을 옮긴 설정 파일이 있습니다.

ES 모듈을 불러올 수 있도록 로컬 HTTP 서버로 실행합니다:

```powershell
# Python 3가 설치돼 있다면
python -m http.server 8000
# → http://localhost:8000
```

## 배포 (GitHub Pages)

1. GitHub repo → **Settings → Secrets and variables → Actions**에 Repository secret `FIREBASE_CONFIG`를 추가합니다. 값은 `js/firebase-config.js`의 설정 객체를 JSON으로 바꾼 내용입니다. `export const firebaseConfig =`와 마지막 세미콜론을 제외하고, 속성 이름도 큰따옴표로 감싸며 마지막 속성 뒤 쉼표를 제거합니다.
2. **Settings → Pages → Source**를 **GitHub Actions**로 선택합니다.
3. `main` 브랜치에 push하거나 **Actions → Deploy GitHub Pages → Run workflow**를 실행합니다.
4. 워크플로가 Secret으로 설정 파일을 생성하고 사이트 파일만 배포합니다. 완료 후 `https://<username>.github.io/BibleQuiz/`에서 확인합니다.

실제 설정 파일이 Git에서 제외되므로 기존 **Deploy from a branch** 방식으로는 설정 파일이 배포되지 않습니다. 위 설정 변경이 필요합니다.

Firebase 웹 설정은 브라우저에서 사용하므로 배포 후 방문자가 확인할 수 있습니다. 파일 분리는 저장소에 설정 값을 커밋하지 않기 위한 것이며, 데이터 접근은 Firebase Security Rules로 제한해야 합니다. 과거 Git 커밋에 있던 값은 이번 변경으로 삭제되지 않습니다. 자세한 내용은 [Firebase API 키 문서](https://firebase.google.com/docs/projects/api-keys)를 참고하세요.

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
│   ├── firebase.js   # Firebase 데이터 접근
│   ├── firebase-config.js # 실제 설정 (Git 제외)
│   ├── firebase-config.example.js # 설정 예시
│   └── app.js        # 앱 로직
└── README.md
```
