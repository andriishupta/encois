package observability

import (
	"context"
	"testing"
)

func TestSetupWithoutEndpointCreatesLocalProvider(t *testing.T) {
	t.Setenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "")
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "")
	shutdown, err := Setup(context.Background(), "test-runtime")
	if err != nil {
		t.Fatal(err)
	}
	if shutdown == nil {
		t.Fatal("expected tracer provider shutdown function")
	}
	ctx, span := StartSpan(context.Background(), "test-span")
	if ctx == nil || span == nil {
		t.Fatal("expected a span context and span")
	}
	span.End()
	if err := shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestTraceExporterOptionsAcceptsHostAndHTTPURL(t *testing.T) {
	for _, endpoint := range []string{"127.0.0.1:4318", "http://127.0.0.1:4318/v1/traces"} {
		options, err := traceExporterOptions(endpoint)
		if err != nil || len(options) == 0 {
			t.Fatalf("expected endpoint %q to produce exporter options, options=%v err=%v", endpoint, options, err)
		}
	}
}
