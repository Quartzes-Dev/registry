module github.com/pulumi/registry

go 1.16

require (
	github.com/pulumi/pulumi-hugo v0.0.0-20230119224808-61e64409592f // indirect
	github.com/pulumi/pulumi-hugo/themes/default v0.0.0-20230118213626-5db99638b28a // indirect
)

// The override is needed because this repo is currently private and module at themes/default
// will be considered a private Go module as well. We could configure an SSH key to get around
// that but this is simpler for the time being.
replace github.com/pulumi/registry/themes/default => ./themes/default
