package observability

import (
	"context"
	"net/url"
	"os"
	"strings"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

func Setup(ctx context.Context, serviceName string) (func(context.Context) error, error) {
	resourceAttrs := resource.NewSchemaless(attribute.String("service.name", serviceName))
	options := []sdktrace.TracerProviderOption{
		sdktrace.WithResource(resourceAttrs),
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
	}
	endpoint := os.Getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")
	if endpoint == "" {
		endpoint = os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	}
	if strings.TrimSpace(endpoint) != "" {
		exporterOptions, err := traceExporterOptions(endpoint)
		if err != nil {
			return nil, err
		}
		exporter, err := otlptracehttp.New(ctx, exporterOptions...)
		if err != nil {
			return nil, err
		}
		options = append(options, sdktrace.WithBatcher(exporter))
	}
	provider := sdktrace.NewTracerProvider(options...)
	otel.SetTracerProvider(provider)
	otel.SetTextMapPropagator(propagation.TraceContext{})
	return provider.Shutdown, nil
}

func StartSpan(ctx context.Context, name string, attrs ...attribute.KeyValue) (context.Context, trace.Span) {
	return otel.Tracer("encois/agent-gateway").Start(ctx, name, trace.WithAttributes(attrs...))
}

func traceExporterOptions(raw string) ([]otlptracehttp.Option, error) {
	if !strings.Contains(raw, "://") {
		return []otlptracehttp.Option{otlptracehttp.WithEndpoint(raw), otlptracehttp.WithInsecure()}, nil
	}
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return nil, err
	}
	if parsed.Scheme == "" {
		return []otlptracehttp.Option{otlptracehttp.WithEndpoint(parsed.Path), otlptracehttp.WithInsecure()}, nil
	}
	if parsed.Host == "" {
		return nil, &url.Error{Op: "parse", URL: raw, Err: errMissingTraceEndpointHost}
	}
	options := []otlptracehttp.Option{otlptracehttp.WithEndpoint(parsed.Host)}
	if parsed.Scheme == "http" {
		options = append(options, otlptracehttp.WithInsecure())
	}
	if parsed.Path != "" && parsed.Path != "/" {
		options = append(options, otlptracehttp.WithURLPath(parsed.Path))
	}
	return options, nil
}

var errMissingTraceEndpointHost = traceEndpointError("OTLP trace endpoint host is required")

type traceEndpointError string

func (e traceEndpointError) Error() string { return string(e) }
