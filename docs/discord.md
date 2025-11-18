i think i have an issue that's related to this.

In contrast to the post author, im using Bun.server(), but my problem is with how to build a respond with html without loosing bundler magic:

option 1:
```ts
import app from "~/app/index.html";
const createServerConfig = () => ({
	port: 3000,
	
	routes: {
		// Public HTML routes
		"/": landing,
		"/login": login,
		 
		// Protected app route - auth check + HTML import
		"/app": async (req: Request) => {
			try {
				await getUserId(req);
				return new Response(file(app.index));
			} catch {
				return Response.redirect("/login");
			}
		}
	},
});
```
in response i get html, but without css and js:
```console
tailwindcss:1  Failed to load resource: the server responded with a status of 404 (Not Found)
global.css:1  Failed to load resource: the server responded with a status of 404 (Not Found)
app.ts:1  Failed to load resource: the server responded with a status of 404 (Not Found)
```

option 2:
```ts
import app from "~/app/index.html";
const createServerConfig = () => ({
	port: 3000,
	
	routes: {
		// Public HTML routes
		"/": landing,
		"/login": login,
		 
		// Protected app route - auth check + HTML import
		"/app": async (req: Request) => {
			try {
				await getUserId(req);
				return app as unknown as Response; // 🤷‍♂️
			} catch {
				return Response.redirect("/login");
			}
		}
	},
});
```
error:
```bush
error: Expected a Response object, but received 'HTMLBundle {
  index: "/src/app/index.html",
}'
```
