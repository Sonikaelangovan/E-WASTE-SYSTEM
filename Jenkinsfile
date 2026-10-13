pipeline {
  agent any
  options { timestamps(); disableConcurrentBuilds() }
  environment {
    DOCKER_BIN = 'C:\\Users\\thira\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin\\docker.exe'
    COMPOSE_BIN = 'C:\\Users\\thira\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin\\docker-compose.exe'
  }
  parameters {
    booleanParam(name: 'DEPLOY', defaultValue: false, description: 'Build and run the local Docker service after tests')
    string(name: 'ENV_FILE', defaultValue: 'C:\\Users\\thira\\Flight_Management\\E-Waste-System\\.env', description: 'Private environment file on this Jenkins agent')
  }
  stages {
    stage('Checkout') { steps { checkout scm } }
    stage('Environment') { steps { bat 'node --version && npm --version' } }
    stage('Syntax Check') { steps { bat 'npm run check' } }
    stage('Automated Tests') { steps { bat 'npm test' } }
    stage('Deployment Prerequisites') {
      when { expression { return params.DEPLOY } }
      steps {
        bat '@if not exist "%ENV_FILE%" (echo Missing private environment file & exit /b 1)'
        bat '"%DOCKER_BIN%" --version && "%COMPOSE_BIN%" version'
      }
    }
    stage('Docker Build') {
      when { expression { return params.DEPLOY } }
      steps { bat '"%COMPOSE_BIN%" --env-file "%ENV_FILE%" build' }
    }
    stage('Deploy') {
      when { expression { return params.DEPLOY } }
      steps { bat '"%COMPOSE_BIN%" --env-file "%ENV_FILE%" up -d --wait && "%COMPOSE_BIN%" --env-file "%ENV_FILE%" ps' }
    }
    stage('Health Check') {
      when { expression { return params.DEPLOY } }
      steps { bat 'curl.exe -fsS http://localhost:8092/api/health' }
    }
  }
  post {
    always { archiveArtifacts artifacts: 'README.md,ansible/**', allowEmptyArchive: true }
  }
}
