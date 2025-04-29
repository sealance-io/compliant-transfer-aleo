# syntax=docker/dockerfile:1.2

ARG AMARELEO_VERSION=v2.2.0
ARG GIT_COMMIT=""
ARG BUILD_DATE=""
ARG REPO_URL=""

FROM ghcr.io/sealance-io/amareleo-chain:${AMARELEO_VERSION}

# OCI standard labels
LABEL org.opencontainers.image.created="${BUILD_DATE}"
LABEL org.opencontainers.image.authors="Sealance.io"
LABEL org.opencontainers.image.url="${REPO_URL}"
LABEL org.opencontainers.image.source="${REPO_URL}"
LABEL org.opencontainers.image.version="${AMARELEO_VERSION}"
LABEL org.opencontainers.image.revision="${GIT_COMMIT}"
LABEL org.opencontainers.image.title="Amareleo Chain Custom"
LABEL org.opencontainers.image.description="Amareleo Chain node with sealance-io programs deployment"
#LABEL org.opencontainers.image.documentation="https://docs.sealance.io"
LABEL org.opencontainers.image.base.name="ghcr.io/sealance-io/amareleo-chain:${AMARELEO_VERSION}"

COPY --chown=amareleo:amareleo ./data/amareleo /data/amareleo

# Set the entrypoint to run the node
ENTRYPOINT ["amareleo-chain", "start"]

# Provide default arguments that can be overridden
CMD ["--network", "1", "--verbosity", "1", "--rest", "0.0.0.0:3030", "--rest-rps", "100", "--storage", "/data/amareleo", "--keep-state"]