# # Makefile

# # Specify the Python version
# PYTHON_VERSION := python3.12
# LAMBDA_VENV := .venv
# PACKAGE_NAME := lambda_package.zip
# LAMBDA_FUNCTION := main.py # Add other files separated by spaces if necessary

# # Default target executed when no arguments are given to make.
# default: clean package

# # Setup a virtual environment
# venv:
# 	$(PYTHON_VERSION) -m venv $(LAMBDA_VENV)
# 	$(LAMBDA_VENV)/bin/pip install -U pip

# # Install dependencies into the virtual environment
# dependencies: venv
# 	$(LAMBDA_VENV)/bin/pip install -r agentLambda/requirements.txt

# # Package the virtual environment libraries and your lambda function into a zip
# package: dependencies
# 	# Adding python packages
# 	cd $(LAMBDA_VENV)/lib/$(PYTHON_VERSION)/site-packages; zip -r9 $(CURDIR)/$(PACKAGE_NAME) .
# 	# Adding your lambda function and any additional files
# 	zip -g $(PACKAGE_NAME) agentLambda/$(LAMBDA_FUNCTION)

# # Clean up the environment
# clean:
# 	rm -rf $(LAMBDA_VENV)
# 	rm -f $(PACKAGE_NAME)

# .PHONY: default venv dependencies package



# =========================
# Config (paths are relative to src/lambdas/)
# =========================
PYTHON := python3.12
VENV := .venv

LAMBDA_SRC_DIR := agentLambda
REQ_FILE := $(LAMBDA_SRC_DIR)/requirements.txt

DIST_DIR := dist
LAMBDA_ZIP := $(DIST_DIR)/lambda_function.zip

# Layer output folder (CDK will point to THIS folder: dependencies/deps)
LAYER_DIR := dependencies/deps
LAYER_PY_DIR := $(LAYER_DIR)/python
LAYER_ZIP := $(DIST_DIR)/layer_deps.zip

# Exclusions for lambda zip (keep it clean)
ZIP_EXCLUDES := \
	-x "$(LAMBDA_SRC_DIR)/requirements.txt" \
	-x "$(LAMBDA_SRC_DIR)/__pycache__/*" \
	-x "$(LAMBDA_SRC_DIR)/**/__pycache__/*" \
	-x "$(LAMBDA_SRC_DIR)/**/*.pyc" \
	-x "$(LAMBDA_SRC_DIR)/**/*.pyo" \
	-x "$(LAMBDA_SRC_DIR)/**/*.pyd" \
	-x "$(LAMBDA_SRC_DIR)/.pytest_cache/*" \
	-x "$(LAMBDA_SRC_DIR)/**/.pytest_cache/*" \
	-x "$(LAMBDA_SRC_DIR)/.mypy_cache/*" \
	-x "$(LAMBDA_SRC_DIR)/**/.mypy_cache/*" \
	-x "$(LAMBDA_SRC_DIR)/.DS_Store" \
	-x "$(LAMBDA_SRC_DIR)/**/.DS_Store"

default: clean build

# =========================
# Build targets
# =========================

venv:
	$(PYTHON) -m venv $(VENV)
	$(VENV)/bin/pip install -U pip

# Build layer deps into dependencies/deps/python/
layer: venv
	rm -rf $(LAYER_PY_DIR)
	mkdir -p $(LAYER_PY_DIR)
	$(VENV)/bin/pip install -r $(REQ_FILE) -t $(LAYER_PY_DIR)

# Zip the entire agentLambda/ folder (excluding requirements.txt and caches)
lambda:
	mkdir -p $(DIST_DIR)
	rm -f $(LAMBDA_ZIP)
	zip -r9 $(LAMBDA_ZIP) $(LAMBDA_SRC_DIR) $(ZIP_EXCLUDES)

# Optional: zip the layer (not required for CDK, but useful to inspect)
layer-zip: layer
	mkdir -p $(DIST_DIR)
	rm -f $(LAYER_ZIP)
	cd $(LAYER_DIR) && zip -r9 $(CURDIR)/$(LAYER_ZIP) python

build: layer lambda layer-zip
	@echo "✅ Built:"
	@echo " - Lambda zip: $(LAMBDA_ZIP)  (contains $(LAMBDA_SRC_DIR)/ minus requirements.txt)"
	@echo " - Layer folder for CDK: $(LAYER_DIR)  (contains python/ deps)"
	@echo " - Optional layer zip: $(LAYER_ZIP)"

clean:
	rm -rf $(DIST_DIR)
	rm -rf $(LAYER_DIR)

clean-all: clean
	rm -rf $(VENV)

.PHONY: default venv layer lambda layer-zip build clean clean-all
