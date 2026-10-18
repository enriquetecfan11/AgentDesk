'use client';

import Script from 'next/script';
import { useTheme } from 'next-themes';
import { useEffect, useRef, useState } from 'react';

type SwaggerInstance = { destroy?: () => void };
type SwaggerWindow = Window & {
  SwaggerUIBundle?: (config: Record<string, unknown>) => SwaggerInstance;
};

export function ApiReference() {
  const { resolvedTheme } = useTheme();
  const element = useRef<HTMLDivElement>(null);
  const instance = useRef<SwaggerInstance | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!ready || !element.current) return;
    const swagger = (window as SwaggerWindow).SwaggerUIBundle;
    if (!swagger) { setFailed(true); return; }
    instance.current = swagger({
      url: '/api/openapi.json',
      domNode: element.current,
      deepLinking: true,
      displayRequestDuration: true,
      tryItOutEnabled: false,
    });
    return () => {
      instance.current?.destroy?.();
      instance.current = null;
      if (element.current) element.current.replaceChildren();
    };
  }, [ready]);

  return (
    <>
      <link
        rel="stylesheet"
        href="https://unpkg.com/swagger-ui-dist@5.11.10/swagger-ui.css"
      />
      <Script
        src="https://unpkg.com/swagger-ui-dist@5.11.10/swagger-ui-bundle.js"
        strategy="afterInteractive"
        onReady={() => setReady(true)}
        onError={() => setFailed(true)}
      />
      {!ready && !failed && <p className="p-6" role="status">Cargando documentación…</p>}
      {failed && <p className="p-6" role="alert">No se ha podido cargar la documentación. Puedes consultar el <a className="underline" href="/api/openapi.json">OpenAPI JSON</a>.</p>}
      <div ref={element} className={`api-docs ${resolvedTheme === 'dark' ? 'api-docs-dark' : ''}`} />
    </>
  );
}
